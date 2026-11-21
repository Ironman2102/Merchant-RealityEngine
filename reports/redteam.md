# Red team (synthetic)

**Synthetic.** 24 thinned copies of the Telegram betting sample. This is not a live attacker.

- Evasion rate 20/24 = 0.833, Wilson 95% 0.641–0.933
- Operator: thinSales (keep about 8–12% of sales). Attacker cost 5 in rules/redteam.json units.
- Backstop: lowering minN inside its band catches this evasion. See `mre demo:learn`.
