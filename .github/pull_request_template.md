## What was wrong

<!-- What houserules did wrong, or what it couldn't do, and on what kind of code. -->

## What changed

<!-- The fix in a few bullets. Call out anything that changes existing output (ids, labels, defaults). -->

## Before / after

<!-- For scan, trace or docs changes: what houserules printed on main, and what it prints now. -->

```
before (main)

after
```

## Checklist

- [ ] `npm test` passes, with a new test that fails without this change
- [ ] Cache version bumped if what gets cached changed
- [ ] MCP tool descriptions, `SKILL.md` and `README.md` updated if behaviour or options changed
- [ ] houserules still reads only: no writes outside its own files, no network, no running the repo's code
- [ ] No private code, company names or secrets in fixtures, examples or docs

See [CONTRIBUTING.md](../CONTRIBUTING.md).
