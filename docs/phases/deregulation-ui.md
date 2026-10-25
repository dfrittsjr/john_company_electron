# Deregulation UI notes

- Scenarios: `PLAYABLE_SCENARIOS` in `src/online/protocol.ts` (1710, Long 1710) drives the hotseat
  screen (1758/1813 shown disabled), the online form and the worker's create validation.
- Firm charter: `src/ui/FirmCharter.tsx`, shown on its manager's dashboard. Other dashboards list firm
  shares held (with VP now), Debtor's Prison and "invested in a firm" workshops.
- Secrecy: a strategy and bid show only when `revealedPlayer` is the manager, or once `revealed` /
  `firm.trade` is set. Missing secret fields (online projection) read as "chosen, secret".
- Deregulation status: header strip and Laws tab (`firm-view.ts` mirrors the p.36 lined/starred rule,
  ruling 1, only to say may/must; the engine decides).
- Board: orders filled by firms get a dashed blue ring labelled "firm" ("both" with the Company); the
  tooltip and details panel name the firms. Firm ships are counted on the charter, not drawn at sea.
- Rules: the Deregulation section (pp.37-42) is no longer marked "not in app" and opens from the Firms phase.
- Assumption: firm decisions appear as ordinary decision buttons, grouped by command type.
