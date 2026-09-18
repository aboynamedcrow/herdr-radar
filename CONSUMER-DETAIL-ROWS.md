# Consumer detail rows

Set `detail_rows = true` when the consumer supplies tab and quota rows.
The default is false.

Radar publishes `rd_tab` and `rd_quota_*` tokens for these rows.
It copies quota display values from Agent Quota.
It adds indentation to the first visible value in each row.
It clears copies when their source values disappear.
Agent Quota remains the collector and owns the original tokens.

Use the copied tokens in the consumer's sidebar layout.
Keep the original color rules for each quota tier.
Use explicit vendor colors and `dim = false` for all three logo tokens.
This keeps idle icons visible while their titles fade.

Set Herdr's base agent order to `spaces` when Radar owns grouping.
Some clients preserve a manual priority preference across configuration reloads.
That preference can reorder agents after Radar places their headers.
Clear Radar's view temporarily, select `grouped` in Herdr, then restore Radar's view.
This changes presentation only. It does not move panes or restart agents.

With Radar's sort override off, Herdr keeps its native workspace order.
A worktree can then appear after an unrelated workspace.
Radar repeats the parent header at the start of each separate family block.
Adjacent sibling worktrees share one block with a gap at its end.
