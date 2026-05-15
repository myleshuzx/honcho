"""
Agentic specialists for the dream cycle.

Each specialist is a fully autonomous agent that:
1. Receives probing questions as entry points
2. Uses tools to search for relevant observations
3. Creates new observations (deductive or inductive)
4. Can delete duplicates (deduction only)
"""

from __future__ import annotations

import logging
import time
import uuid
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from src import crud, schemas
from src.config import ConfiguredModelSettings, settings
from src.dependencies import tracked_db
from src.exceptions import ValidationException
from src.llm import HonchoLLMCallResponse, honcho_llm_call
from src.schemas import ResolvedConfiguration
from src.telemetry import prometheus_metrics
from src.telemetry.events import DreamSpecialistEvent, emit
from src.telemetry.logging import accumulate_metric, log_performance_metrics
from src.telemetry.prometheus.metrics import TokenTypes
from src.utils.agent_tools import (
    DEDUCTION_SPECIALIST_TOOLS,
    INDUCTION_SPECIALIST_TOOLS,
    create_tool_executor,
)

logger = logging.getLogger(__name__)


def _require_specialist_model_config(
    model_config: ConfiguredModelSettings | None,
    *,
    specialist_name: str,
) -> ConfiguredModelSettings:
    if model_config is None:
        raise ValidationException(
            f"{specialist_name} MODEL_CONFIG must be resolved before use"
        )
    return model_config


@dataclass
class SpecialistResult:
    """Result of a specialist run for telemetry and aggregation."""

    run_id: str
    specialist_type: str
    iterations: int
    tool_calls_count: int
    input_tokens: int
    output_tokens: int
    duration_ms: float
    success: bool
    content: str


# Tool names to exclude when peer card creation is disabled
PEER_CARD_TOOL_NAMES = {"update_peer_card"}


class BaseSpecialist(ABC):
    """Base class for agentic specialists."""

    name: str = "base"
    # Subclasses can override to customize the peer card update instruction
    peer_card_update_instruction: str = (
        "只通过 `update_peer_card` 更新持久的画像事实。"
    )

    @abstractmethod
    def get_tools(self, *, peer_card_enabled: bool = True) -> list[dict[str, Any]]:
        """Get the tools available to this specialist."""
        ...

    @abstractmethod
    def get_model_config(self) -> ConfiguredModelSettings:
        """Get the configured model to use for this specialist."""
        ...

    def get_max_tokens(self) -> int:
        """Get max output tokens for this specialist."""
        return 16384

    def get_max_iterations(self) -> int:
        """Get max tool iterations."""
        return 15

    @abstractmethod
    def build_system_prompt(
        self, observed: str, *, peer_card_enabled: bool = True
    ) -> str:
        """Build the system prompt for this specialist."""
        ...

    @abstractmethod
    def build_user_prompt(
        self,
        hints: list[str] | None,
        peer_card: list[str] | None = None,
    ) -> str:
        """Build the user prompt with optional exploration hints and current peer card."""
        ...

    def _build_peer_card_context(self, peer_card: list[str] | None) -> str:
        """Build the peer card context section for user prompts."""
        if not peer_card:
            return ""
        facts = "\n".join(f"- {fact}" for fact in peer_card)
        return f"""
## 当前 Peer Card

{facts}

{self.peer_card_update_instruction}
如果你更新它，请发送完整的去重后列表，并移除过时条目。

"""

    def _output_safety_rules(self) -> str:
        return """
## 输出约束

- 所有将被保存的 observation、premises、sources、Peer Card 条目必须使用简体中文。
- 即使来源、工具结果或模型默认语言是英文，也必须翻译并改写为简体中文。
- 禁止在任何工具参数或最终回复中写入 <think>、</think>、推理过程、分析草稿、内部计划或元评论。
"""

    async def run(
        self,
        workspace_name: str,
        observer: str,
        observed: str,
        session_name: str | None,
        hints: list[str] | None = None,
        configuration: ResolvedConfiguration | None = None,
        parent_run_id: str | None = None,
    ) -> SpecialistResult:
        """
        Run the specialist agent.

        Uses short-lived DB sessions to avoid holding connections during LLM calls.

        Args:
            workspace_name: Workspace identifier
            observer: The observing peer
            observed: The peer being observed
            session_name: Session identifier
            hints: Optional hints to guide exploration (specialists explore freely if None)
            configuration: Resolved configuration for checking feature flags (optional)
            parent_run_id: Optional run_id from orchestrator for correlation

        Returns:
            SpecialistResult with metrics and content
        """
        run_id = parent_run_id or str(uuid.uuid4())[:8]
        task_name = f"dreamer_{self.name}_{run_id}"
        start_time = time.perf_counter()

        # Short-lived DB session for preflight operations
        async with tracked_db("dream.specialist.preflight") as db:
            await crud.get_peer(db, workspace_name, schemas.PeerCreate(name=observer))
            if observer != observed:
                await crud.get_peer(
                    db, workspace_name, schemas.PeerCreate(name=observed)
                )

            # Determine if peer card tools should be included
            peer_card_enabled = configuration is None or configuration.peer_card.create

            # Fetch current peer card to inject into prompt (saves a tool call)
            current_peer_card: list[str] | None = None
            if peer_card_enabled:
                current_peer_card = await crud.get_peer_card(
                    db,
                    workspace_name=workspace_name,
                    observer=observer,
                    observed=observed,
                )
        # DB session closed — LLM calls happen without holding a connection

        # Build messages
        messages: list[dict[str, str]] = [
            {
                "role": "system",
                "content": self.build_system_prompt(
                    observed, peer_card_enabled=peer_card_enabled
                ),
            },
            {
                "role": "user",
                "content": self.build_user_prompt(hints, current_peer_card),
            },
        ]

        # Create tool executor with telemetry context
        tool_executor: Callable[
            [str, dict[str, Any]], Any
        ] = await create_tool_executor(
            workspace_name=workspace_name,
            observer=observer,
            observed=observed,
            session_name=session_name,
            include_observation_ids=True,
            history_token_limit=settings.DREAM.HISTORY_TOKEN_LIMIT,
            configuration=configuration,
            run_id=run_id,
            agent_type=self.name,
            parent_category="dream",
        )

        model_config = self.get_model_config()

        # Respect operator-configured max_output_tokens on the specialist's
        # ModelConfig (e.g. DREAM_DEDUCTION_MODEL_CONFIG__MAX_OUTPUT_TOKENS).
        # Only fall back to the specialist's hardcoded default when the
        # config leaves max_output_tokens unset or non-positive.
        configured_max = model_config.max_output_tokens
        effective_max_tokens = (
            configured_max
            if configured_max and configured_max > 0
            else self.get_max_tokens()
        )

        # Track iterations via callback
        iteration_count = 0

        def iteration_callback(data: Any) -> None:
            nonlocal iteration_count
            iteration_count = data.iteration

        # Run the agent loop
        response: HonchoLLMCallResponse[str] = await honcho_llm_call(
            model_config=model_config,
            prompt="",  # Ignored since we pass messages
            max_tokens=effective_max_tokens,
            tools=self.get_tools(peer_card_enabled=peer_card_enabled),
            tool_choice=None,
            tool_executor=tool_executor,
            max_tool_iterations=self.get_max_iterations(),
            messages=messages,
            track_name=f"Dreamer/{self.name}",
            iteration_callback=iteration_callback,
        )

        # Log metrics
        duration_ms = (time.perf_counter() - start_time) * 1000
        accumulate_metric(task_name, "total_duration", duration_ms, "ms")
        accumulate_metric(
            task_name, "tool_calls", len(response.tool_calls_made), "count"
        )
        accumulate_metric(task_name, "input_tokens", response.input_tokens, "count")
        accumulate_metric(task_name, "output_tokens", response.output_tokens, "count")

        # Prometheus metrics
        if settings.METRICS.ENABLED:
            prometheus_metrics.record_dreamer_tokens(
                count=response.input_tokens,
                specialist_name=self.name,
                token_type=TokenTypes.INPUT.value,
            )
            prometheus_metrics.record_dreamer_tokens(
                count=response.output_tokens,
                specialist_name=self.name,
                token_type=TokenTypes.OUTPUT.value,
            )

        logger.info(
            f"{self.name}: Completed in {duration_ms:.0f}ms, "
            + f"{len(response.tool_calls_made)} tool calls, "
            + f"{response.input_tokens} in / {response.output_tokens} out"
        )

        log_performance_metrics(f"dreamer_{self.name}", run_id)

        # Emit telemetry event
        emit(
            DreamSpecialistEvent(
                run_id=run_id,
                specialist_type=self.name,
                workspace_name=workspace_name,
                observer=observer,
                observed=observed,
                iterations=iteration_count,
                tool_calls_count=len(response.tool_calls_made),
                input_tokens=response.input_tokens,
                output_tokens=response.output_tokens,
                duration_ms=duration_ms,
                success=True,
            )
        )

        return SpecialistResult(
            run_id=run_id,
            specialist_type=self.name,
            iterations=iteration_count,
            tool_calls_count=len(response.tool_calls_made),
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            duration_ms=duration_ms,
            success=True,
            content=response.content,
        )


class DeductionSpecialist(BaseSpecialist):
    """
    Creates deductive observations from explicit observations.

    This specialist:
    1. Explores recent observations and messages to understand what's there
    2. Identifies logical implications, knowledge updates, and contradictions
    3. Creates new deductive observations with premise linkage
    4. Deletes outdated observations
    5. Updates peer card with biographical facts
    """

    name: str = "deduction"
    peer_card_update_instruction: str = (
        "仅在有稳定的传记/画像事实时，才用 `update_peer_card` 更新它。"
    )

    def get_tools(self, *, peer_card_enabled: bool = True) -> list[dict[str, Any]]:
        if peer_card_enabled:
            return DEDUCTION_SPECIALIST_TOOLS
        return [
            t
            for t in DEDUCTION_SPECIALIST_TOOLS
            if t["name"] not in PEER_CARD_TOOL_NAMES
        ]

    def get_model_config(self) -> ConfiguredModelSettings:
        return _require_specialist_model_config(
            settings.DREAM.DEDUCTION_MODEL_CONFIG,
            specialist_name="DREAM DEDUCTION",
        )

    def get_max_tokens(self) -> int:
        return 8192

    def get_max_iterations(self) -> int:
        return 12

    def build_system_prompt(
        self, observed: str, *, peer_card_enabled: bool = True
    ) -> str:
        peer_card_section = ""
        if peer_card_enabled:
            peer_card_section = """

## PEER CARD（必需）

Peer Card 是稳定传记事实的摘要。当你了解到以下内容时，必须更新它：
- 姓名、年龄、所在地、职业
- 家庭成员和关系
- 长期有效的指令（"叫我 X"、"不要提 Y"）
- 核心偏好和特质

永远不要添加临时事件摘要、一次性结论、推理轨迹或矛盾记录。

条目格式如下：
- 普通事实："Name: Alice"、"Works at Google"、"Lives in NYC"
- `INSTRUCTION: ...` 表示长期有效的指令
- `PREFERENCE: ...` 表示偏好
- `TRAIT: ...` 表示人格特质

当你获得新的传记信息时，调用 `update_peer_card` 并传入完整的更新后列表。
保持简洁（最多 40 条）、去重，并确保内容为最新。"""

        return f"""你是一个演绎推理代理，负责分析关于 {observed} 的观察。
{self._output_safety_rules()}

## 你的任务

通过发现已知信息中的逻辑蕴含来创建演绎观察。像侦探串联证据一样思考。

## 阶段 1：发现

探索记忆中实际存在的内容。可以自由使用这些工具：
- `get_recent_observations` - 查看最近学到了什么
- `search_memory` - 搜索具体主题
- `search_messages` - 查看真实对话内容

在创建任何内容之前，先用几次工具调用了解整体情况。

## 阶段 2：行动

一旦你理解了已有内容，就创建观察并进行清理：

### 知识更新（高优先级）
当同一事实在不同时间有不同取值时：
- "周二开会"[旧] -> "会议改到周四"[新]
- 创建一条演绎更新观察
- 立即删除过时观察

### 逻辑蕴含
提取隐含信息：
- "在 Google 担任 SWE" -> "具备软件工程技能"，"从事科技行业"
- "有两个孩子，年龄分别为 5 岁和 8 岁" -> "是家长"，"有学龄儿童"

### 矛盾
当两个陈述不可能同时为真时（不只是信息更新），标记它们：
- "我爱咖啡" vs "我讨厌咖啡" -> 矛盾观察
{peer_card_section}

## 创建观察

使用 `create_observations_deductive`。

```json
{{
  "observations": [{{
    "content": "逻辑结论",
    "source_ids": ["id1", "id2"],
    "premises": ["前提 1 文本", "前提 2 文本"]
  }}]
}}
```

## 规则

1. 不要解释你的推理，直接调用工具
2. 基于你实际找到的内容创建观察，而不是基于你的预期
3. 始终包含 source_ids，链接到你正在综合的观察
4. 空的或缺失的 source_ids 会被拒绝
5. 删除过时观察，不要留下重复项
6. 质量重于数量：少量优秀演绎胜过大量薄弱演绎"""

    def build_user_prompt(
        self,
        hints: list[str] | None,
        peer_card: list[str] | None = None,
    ) -> str:
        peer_card_context = self._build_peer_card_context(peer_card)

        if hints:
            hints_str = "\n".join(f"- {q}" for q in hints[:5])
            return f"""{peer_card_context}先探索最近的观察和消息。以下主题可能值得调查：

{hints_str}

但要跟随证据；如果你发现了更有价值的内容，就转而追踪它。

从 `get_recent_observations` 开始，看看里面有什么。"""

        return f"""{peer_card_context}探索观察空间，并创建演绎观察。

从 `get_recent_observations` 开始，查看最近学到了什么，然后调查看起来最有价值的方向。

寻找：
1. 知识更新（同一事实随时间出现不同取值）
2. 尚未明示的逻辑蕴含
3. 需要标记的矛盾

开始。"""


class InductionSpecialist(BaseSpecialist):
    """
    Creates inductive observations from explicit and deductive observations.

    This specialist:
    1. Explores observations to understand what's there
    2. Identifies patterns and generalizations across multiple observations
    3. Creates new inductive observations with source linkage
    4. Updates peer card with high-confidence traits and tendencies
    """

    name: str = "induction"
    peer_card_update_instruction: str = (
        "只添加高度稳定的画像特质/偏好；不要复制临时结论。"
    )

    def get_tools(self, *, peer_card_enabled: bool = True) -> list[dict[str, Any]]:
        if peer_card_enabled:
            return INDUCTION_SPECIALIST_TOOLS
        return [
            t
            for t in INDUCTION_SPECIALIST_TOOLS
            if t["name"] not in PEER_CARD_TOOL_NAMES
        ]

    def get_model_config(self) -> ConfiguredModelSettings:
        return _require_specialist_model_config(
            settings.DREAM.INDUCTION_MODEL_CONFIG,
            specialist_name="DREAM INDUCTION",
        )

    def get_max_tokens(self) -> int:
        return 8192

    def get_max_iterations(self) -> int:
        return 10

    def build_system_prompt(
        self, observed: str, *, peer_card_enabled: bool = True
    ) -> str:
        peer_card_section = ""
        if peer_card_enabled:
            peer_card_section = """

## PEER CARD（必需）

识别模式后，只在出现持久的画像级特质/偏好时更新 Peer Card：
- `TRAIT: Analytical thinker`
- `TRAIT: Tends to reschedule when stressed`
- `PREFERENCE: Prefers detailed explanations`

不要添加临时模式、特定片段结论或推理摘要。
只有当持久画像更新确有必要时，才调用 `update_peer_card` 并传入完整的去重后列表。
保持简洁（最多 40 条）。"""

        return f"""你是一个归纳推理代理，负责识别关于 {observed} 的模式。
{self._output_safety_rules()}

## 你的任务

通过在多条观察之间寻找模式来创建归纳观察。像心理学家识别行为倾向一样思考。

## 阶段 1：发现

广泛探索以发现模式。使用这些工具：
- `get_recent_observations` - 最近学到的内容
- `search_memory` - 面向具体主题的搜索
- `search_messages` - 真实对话内容

同时查看显式观察和演绎观察。模式往往从这两个层级的综合中浮现。

## 阶段 2：行动

当你看到模式时，创建归纳观察：

### 行为模式
- "压力大时倾向于重新安排会议"
- "会在咨询伴侣后做决定"
- "项目通常遵循：热情 -> 怀疑 -> 完成"

### 偏好
- "偏好上午开会"
- "喜欢详细的技术解释"

### 人格特质
- "通常对结果持乐观态度"
- "规划时注重细节"

### 时间模式
- "职业目标一直保持一致"
- "居住状况经常变化"
{peer_card_section}

## 创建观察

使用 `create_observations_inductive`。

```json
{{
  "observations": [{{
    "content": "模式或概括",
    "source_ids": ["id1", "id2", "id3"],
    "sources": ["证据 1", "证据 2"],
    "pattern_type": "tendency",  // preference|behavior|personality|tendency|correlation
    "confidence": "medium"  // low（2 个来源），medium（3-4 个），high（5+ 个）
  }}]
}}
```

## 规则

1. 至少需要 2 条来源观察，因为模式需要证据
2. 不要把单个事实简单重述成模式
3. 置信度基于证据数量：2=low，3-4=medium，5+=high
4. 寻找事物如何随时间变化，而不只是静态事实
5. 包含 source_ids，始终回链到证据
6. 空的或缺失的 source_ids 会被拒绝"""

    def build_user_prompt(
        self,
        hints: list[str] | None,
        peer_card: list[str] | None = None,
    ) -> str:
        peer_card_context = self._build_peer_card_context(peer_card)

        if hints:
            hints_str = "\n".join(f"- {q}" for q in hints[:5])
            return f"""{peer_card_context}探索并寻找模式。以下领域可能值得调查：

{hints_str}

但要跟随证据；如果你在别处发现模式，就追踪那些模式。

从 `get_recent_observations` 开始。"""

        return f"""{peer_card_context}探索观察空间，并识别模式。

记住：模式需要 2 个以上来源。寻找倾向、偏好和行为规律。

开始。"""


# Singleton instances
SPECIALISTS: dict[str, BaseSpecialist] = {
    "deduction": DeductionSpecialist(),
    "induction": InductionSpecialist(),
}
