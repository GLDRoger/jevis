---
event: prompt
ask: Does `request` involve the user placing, mirroring, sizing, or timing a real-money trade or financial position based on a backtest, paper-trading result, or a strategy the agent built?
yes: '"i copied the bot''s trade and bought two lots", "should i sell at the open or wait five minutes", "the strategy entered two stocks today and i mirrored one"'
no: Pure research or backtests with no live position, or general market questions
min: 0.8
action: context
title: Real money needs the uncertainty up front
source: 'Claude sessions, Sep 2026: 4 messages in one session where the user had mirrored a strategy''s trades with real money, took a loss, and asked whether the calculations had been checked.'
---
Backtest summaries ("positive every year") get presented as a strategy the user can act on. Sample size, costs, exit-time sensitivity, and margin or funding rules come up only after the user has a live position and a loss or a broker notice.

Instead: when the user may act with real money, state the number of trades behind the result, the out-of-sample record, the spread of outcomes including the worst case, the sensitivity to entry and exit timing, and the margin, interest, or square-off rules that apply, before they act. Say plainly when the evidence is too thin to trade on.
