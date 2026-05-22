"""
Minimal prompts for the deriver module optimized for speed.

This module contains simplified prompt templates focused only on observation extraction.
NO peer card instructions, NO working representation - just extract observations.
"""

from functools import cache
from inspect import cleandoc as c

from src.utils.tokens import estimate_tokens


def _normalized_custom_instructions(custom_instructions: str | None) -> str | None:
    """Return stripped custom instructions, if any."""
    if custom_instructions is None:
        return None

    normalized = custom_instructions.strip()
    return normalized or None


def _custom_instructions_section(custom_instructions: str | None) -> str:
    """Render optional custom instructions for the deriver prompt."""
    normalized_custom_instructions = _normalized_custom_instructions(custom_instructions)
    if normalized_custom_instructions is None:
        return ""

    return c(
        f"""
        自定义指令：
        {normalized_custom_instructions}
        """
    )


def minimal_deriver_prompt(
    peer_id: str,
    messages: str,
    custom_instructions: str | None = None,
) -> str:
    """
    Generate minimal prompt for fast observation extraction.

    Args:
        peer_id: The ID of the user being analyzed.
        messages: All messages in the range (interleaving messages and new turns combined).
        custom_instructions: Optional workspace/session-specific extraction guidance.

    Returns:
        Formatted prompt string for observation extraction.
    """
    custom_instructions_section = _custom_instructions_section(custom_instructions)
    return c(
        f"""
分析来自 {peer_id} 的消息，提取关于 {peer_id} 的显式原子事实。

[EXPLICIT] 定义：可以直接从 {peer_id} 的消息中得出的、关于 {peer_id} 的事实。
   - 将陈述转换成一个或多个结论。
   - 每个结论都必须自成一体，并包含足够上下文。
   - 尽可能使用绝对日期和时间，例如使用“2025 年 6 月 26 日”，不要使用“昨天”。
   - 如果消息只是在引用他人、转述材料或记录外部事件，不要错误地归因给 {peer_id}。

规则：
- 将观察正确归属到对应主体：如果内容是关于 {peer_id} 的，就明确说明；如果 {peer_id} 引用的是其他人或其他事物，也要说清楚。
- 观察应当脱离原始上下文也能成立。每条观察都将用于未来更好地理解 {peer_id}。
- 提取 {peer_id} 消息中的全部重要观察，并把其他人的消息作为上下文使用。
- 为每条观察补充足够语境，例如写“Ann 对药店工作面试感到紧张”，不要只写“Ann 很紧张”。
- 所有 observation.content 必须使用简体中文。即使原消息、自定义指令或示例是英文，也必须翻译并改写为简体中文。
- 禁止在 observation.content 中包含 <think>、</think>、推理过程、分析草稿、内部计划或元评论。
- 不要输出和事实无关的格式说明、来源说明或对任务本身的评价。

示例：
- EXPLICIT：“我刚在上周六过完 25 岁生日” -> “{peer_id} 25 岁”，“{peer_id} 的生日是 6 月 21 日”
- EXPLICIT：“我在纽约市遛了我的狗” -> “{peer_id} 有一只狗”，“{peer_id} 住在纽约市”
- EXPLICIT：“{peer_id} 上过大学” + 通识知识 -> “{peer_id} 已完成高中或同等学历”

{custom_instructions_section}

待分析的消息：
<messages>
{messages}
</messages>

Temporal output rules:
- If an explicit observation describes an event with clear time evidence, include optional fields: temporal_kind="event", occurred_at as an ISO timestamp/date, and temporal_evidence as the exact source phrase.
- Resolve relative phrases such as "yesterday", "today", "tomorrow", "昨天", "今天", "明天" against the timestamp printed before the source message.
- Only write an absolute event date in content when you also provide occurred_at and temporal_evidence for the same observation.
- If event timing is unclear, remove relative/absolute event dates from content and leave occurred_at absent.
- For preferences, opinions, states, identity facts, or unclear timing, omit occurred_at and use temporal_kind="preference", "state", "observation", or "unknown".
- Never invent occurred_at. If unsure, leave it absent.

请只输出 JSON，包含以下字段：
- explicit: 显式观察列表，每个观察必须是包含 content 字段的对象。
- deductive: 推论观察列表，当前 deriver 不使用该字段，请返回空数组。
格式：{{"explicit": [{{"content": "观察内容"}}, {{"content": "另一个观察"}}], "deductive": []}}
"""
    )


@cache
def estimate_minimal_deriver_prompt_tokens() -> int:
    """Estimate the static minimal deriver prompt without custom instructions."""
    prompt = minimal_deriver_prompt(
        peer_id="",
        messages="",
        custom_instructions=None,
    )
    return estimate_tokens(prompt)


def estimate_deriver_prompt_tokens(custom_instructions: str | None) -> int:
    """Estimate minimal deriver prompt tokens, including custom instructions if present."""
    normalized_custom_instructions = _normalized_custom_instructions(custom_instructions)
    if normalized_custom_instructions is None:
        return estimate_minimal_deriver_prompt_tokens()

    prompt = minimal_deriver_prompt(
        peer_id="",
        messages="",
        custom_instructions=normalized_custom_instructions,
    )
    return estimate_tokens(prompt)
