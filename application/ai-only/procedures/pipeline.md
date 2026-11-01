# Create a pipeline and missing infrastructure for a solution

Its own approved plan, never a side effect of building an item.

## Read only these

- `ai-only/<solution>/_solution.md`: its `resource`, `provision`, `env`,
  `setting`, `pipeline`, `cmd` and `rule` lines. If it is missing, translate
  `<solution>/application-spec.json` first.
- `ai-only/Project_digest.md`: the infra policy and where secrets live.

`<projectRoot>` is the nearest folder above the solution that holds
`Project_brief.md`.

## Rules

- **Never write a secret value** into code, pipeline files, infrastructure
  code, committed config, examples, docs or logs, and never ask for one.
  Reference every setting by name. Tell the person which named secret to create,
  and where.
- **Create only listed resources** that don't exist yet. If the policy says a
  person provisions, write the infrastructure code and list the step for them.
- **Deploy only to environments the AI is allowed to deploy to.**
- **Obey every `rule`** that touches infrastructure: HTTPS-only hosting, TLS-only
  database connections, locked-down CORS origins, and so on.
- A gap is an `UNKNOWN`, never a guess.

## Steps

1. **Plan, then wait.** Start with the approval card from `build.md`. Below it:
   the resources to create and which are left to a person, the pipeline stages
   built from `pipeline` and `cmd` (`cmd: regression`, if there is one, runs on
   every PR), and every named setting each stage needs and
   where its value lives.
2. **Build**, after approval, in the solution's own repo: infrastructure code
   (e.g. `infra/`) and pipeline files (e.g. `.github/workflows/`), with settings
   referenced by name.
3. **Verify locally:** run `cmd: build` and `cmd: test`, and lint the pipeline
   files if a linter is available. Say what only the first pipeline run can
   prove.
4. **Report** in `_solution.md`, under `## Round <n>`, with the same three
   headings as `build.md`. Name every secret a person still has to create.
