"""
Minimal prompts for the deriver module optimized for speed.

This module contains simplified prompt templates focused only on observation extraction.
NO peer card instructions, NO working representation - just extract observations.
"""

from functools import cache
from inspect import cleandoc as c

from src.utils.tokens import estimate_tokens


def minimal_deriver_prompt(
    peer_id: str,
    messages: str,
) -> str:
    """
    Generate minimal prompt for fast observation extraction.

    Args:
        peer_id: The ID of the user being analyzed.
        messages: All messages in the range (interleaving messages and new turns combined).

    Returns:
        Formatted prompt string for observation extraction.
    """
    return c(
        f"""
分析来自 {peer_id} 的消息，提取关于他们的**显式原子事实**。

[EXPLICIT] 定义：可以直接从 {peer_id} 的消息中得出的、关于 {peer_id} 的事实。
   - 将陈述转换成一个或多个结论
   - 每个结论都必须自成一体，并包含足够的上下文
   - 尽可能使用绝对日期/时间（例如用"2025 年 6 月 26 日"，不要用"昨天"）

规则：
- 将观察正确归属到对应主体：如果内容是关于 {peer_id} 的，就明确说明；如果 {peer_id} 引用的是其他人或其他事物，也要说清楚。
- 观察应当脱离原始上下文也能成立。每条观察都将用于未来更好地理解 {peer_id}。
- 提取 {peer_id} 消息中的全部观察，并把其他人的消息作为上下文使用。
- 为每条观察补充足够语境（例如写"Ann 对药店工作面试感到紧张"，不要只写"Ann 很紧张"）
- 所有 observation.content 必须使用简体中文。即使原消息或示例是英文，也必须翻译并改写为简体中文。
- 禁止在 observation.content 中包含 <think>、</think>、推理过程、分析草稿、内部计划或元评论。

示例：
- EXPLICIT："我刚在上周六过完 25 岁生日" -> "{peer_id} 25 岁"，"{peer_id} 的生日是 6 月 21 日"
- EXPLICIT："我在纽约市遛了我的狗" -> "{peer_id} 有一只狗"，"{peer_id} 住在纽约市"
- EXPLICIT："{peer_id} 上过大学" + 通识知识 -> "{peer_id} 已完成高中或同等学历"

待分析的消息：
<messages>
{messages}
</messages>

请以 JSON 格式输出，包含以下字段：
- explicit: 显式观察列表，每个观察必须是包含 content 字段的对象
- deductive: 推论观察列表（暂不使用，留空数组）
格式：{{"explicit": [{{"content": "观察内容"}}, {{"content": "另一个观察"}}], "deductive": []}}
"""
    )


@cache
def estimate_minimal_deriver_prompt_tokens() -> int:
    """Estimate base prompt tokens (cached)."""
    try:
        prompt = minimal_deriver_prompt(
            peer_id="",
            messages="",
        )
        return estimate_tokens(prompt)
    except Exception:
        return 300
