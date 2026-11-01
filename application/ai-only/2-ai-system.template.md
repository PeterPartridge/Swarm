# AI spec format

Checked by `node tools/spec-lint.mjs`. People may read any spec; none has to.

## Front matter

`spec:` digest, system, solution, page, endpoint or model; `from:` the brief,
as a path from the project root. Page, endpoint and model specs also copy the
brief's `deliverable:` and `depends-on: [a, b]` exactly.

## Lines: one fact each

```
key: value [source]
```

- **Source** is where the fact came from:
  - `[id]`: a `### id —` question in the `from:` brief, or a dotted JSON path (`[whatItDoes.purpose]`)
  - `[path#id]`: the same in another file (`[Project_brief.md#roles]`)
  - `[preset:name]` or `[baseline:name]`: an entry in `_forms/boilerplates.json`
  - several: `[actions, limits]`
- **No source means invented.** Leave the line out.
- **Never guess.** A gap or a contradiction is `UNKNOWN: <question> [source]`;
  cite both sides. Only a person writes `DEFERRED: <question> — owner: <name> [source]`.
- Use terse plain English with no invented abbreviations or symbols.
- `#` headings and `>` notes are allowed. Nothing after the first `## Round`
  heading is checked.

## Keys: only these

| File | Keys |
|---|---|
| digest, system | `purpose` `user` `deliverable` `platform` `solution` `infra` `env` `secrets` `rule` `floor` `role` `security` `look` `tier` `skill` |
| solution | `purpose` `host` `lang` `framework` `auth` `talks-to` `look` `style` `log` `docs` `base-path` `layout` `test` `cmd` `rule` `resource` `provision` `env` `setting` `pipeline` `must-not` `limit` |
| page, endpoint, model | `objective` `model` `action` `look` `info` `store` `must` `access` `check` `limit` `uses` `op` `request` `response` `status` `field` `rel` `index` `retention` `sensitive` `invariant` `skill` |
| any | `UNKNOWN` `DEFERRED` |

- `rule`: a house rule with its meaning here, or a security rule.
- `floor`: the testing floor.
- `tier`: when to use which model and effort.
- `cmd`: a command, e.g. `cmd: test = npm test`.
- `check`: `check: C<n> <what must be true>`. IDs are never reused; a test proves
  one by naming `<item>#C<n>`.
- `solution`: `<name> — <type> — <repo> — <local path>`.
- `skill`: `skill: name — why`.

## Example

```
---
spec: page
from: ClothingWebsite/userLogin.md
deliverable: MVP
depends-on: [ClothingAPI/Login.json]
---
objective: so a customer can log in to their account [why-exists]
must: the typed password is never saved [in-memory]
check: C2 wrong password shows an error and does not log in [tests]
UNKNOWN: how does a logged-out customer reset? ResetPassword needs a login [actions, ClothingAPI/Login.json#operations]
```
