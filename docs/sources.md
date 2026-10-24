# Milestone sources

The milestone wording the bot uses is **not** in this repository. It lives in
`data/milestones.private.json` (gitignored) and is loaded into D1 with
`npm run seed:local` or `npm run seed:remote`. `npm run validate:library`
checks the file without seeding.

| Source | Used for | Link | Checked |
|---|---|---|---|
| Health Promotion Board (HPB), Singapore: Health Booklet developmental checklist | Primary source, all age bands from 4 to 8 weeks up to 4 to 6 years | https://ch-api.healthhub.sg/api/public/content/10c1bbb8bbc7480aa24ade00d70ede40 | 2026-10-24 |
| CDC "Learn the Signs. Act Early." | Only where HPB is silent (none used yet) | https://www.cdc.gov/act-early/milestones/ | 2026-10-24 |
| WHO Motor Development Study windows of achievement | Only where HPB is silent (none used yet) | https://www.who.int/tools/child-growth-standards/standards/motor-development-milestones | 2026-10-24 |

## Library file format

```json
{
  "version": "hpb-YYYY-MM-DD",
  "milestones": [
    {
      "id": "unique-id",
      "bandStartMonths": 1,
      "bandEndMonths": 2,
      "domain": "movement | communication | social | thinking",
      "wording": "{Pronoun} ... {possessive} ...",
      "tip": "One short play idea, may use {object}",
      "source": "HPB | CDC | WHO",
      "sourceUrl": "https://..."
    }
  ]
}
```

Placeholders: `{pronoun}` / `{Pronoun}` (subject), `{object}`, `{possessive}`.
Wording is written in the third person singular ("{Pronoun} smiles").
Items must not contain words like "delayed", "behind", "missed", "should" or
"failed". See `test/fixtures/milestones.fixture.json` for a fictional example.
