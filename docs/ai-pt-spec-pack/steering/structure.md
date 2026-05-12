# Structure Steering

## Spec layout

```text
docs/ai-pt-spec-pack/
  README.md
  requirements.md
  design.md
  tasks.md
  agent-flow.md
  steering/
    product.md
    tech.md
    structure.md
```

## Rule of thumb

- use `requirements.md` for what must be true
- use `design.md` for how it should work
- use `tasks.md` for the build sequence
- use `steering/` docs for context that should survive multiple features

## Working method

1. tighten scope in requirements
2. review architecture and guardrails in design
3. break work into tasks
4. only then hand to implementation

## Scaling rule

If a feature is tiny, do not force a heavy spec.
Use the full spec flow only for meaningful workstreams.
