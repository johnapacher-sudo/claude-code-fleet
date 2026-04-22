# Load Balancer Design

## Summary

Add a `fleet lb` command that distributes instructions across a pool of model profiles using round-robin strategy. Each invocation picks the next model and spawns the corresponding tool process in pipe mode (`-p`). On failure, automatically fails over to the next model in the pool.

## Motivation

Users often have multiple API keys and endpoints (e.g., GLM, KIMI, ADA) with similar capabilities. A load balancer distributes load evenly, maximizes throughput, and provides resilience when individual providers fail.

## Data Model

Pools are stored inside the existing `models.json`:

```json
{
  "models": [ ... ],
  "pools": [
    {
      "name": "my-pool",
      "models": ["GLM-wjs", "ADA-公司", "KIMI-部门"],
      "strategy": "round-robin",
      "state": { "lastIndex": -1 }
    }
  ]
}
```

- `name` — unique pool identifier
- `models` — ordered list of model profile names (must exist in `models` array)
- `strategy` — always `"round-robin"` for now; reserved for future strategies
- `state.lastIndex` — index of the last-used model; updated after each successful pick; starts at -1 so first pick is index 0

## CLI Interface

```
fleet lb add                   # Interactive: name the pool, select models from existing profiles
fleet lb list                  # List all pools with their members and last-used model
fleet lb delete                # Interactive: select a pool to delete
fleet lb <pool-name> -- <args> # Pick next model and spawn tool with given args
```

Examples:

```bash
# Create a pool interactively
fleet lb add

# Run instruction via pool
fleet lb my-pool -- -p "refactor the auth module"
fleet lb my-pool -- -p "write unit tests for utils"

# Check pool status
fleet lb list
```

## Execution Flow

1. Parse `fleet lb <pool-name> -- <args>`
2. Load pools from `models.json`
3. Resolve pool by name; error if not found
4. Round-robin pick: `nextIndex = (state.lastIndex + 1) % pool.models.length`
5. Resolve model profile by name; error if profile missing
6. Build spawn args: `adapter.buildArgs(entry)` + passthrough args
7. Spawn tool process with `stdio: 'inherit'`
8. On exit code 0: update `state.lastIndex = nextIndex`, exit 0
9. On non-zero exit: try next model (repeat from step 4), skipping already-tried models
10. If all models fail: print error summary, exit 1

### Failover Logic

- Track attempted indices in a Set
- After failure, increment nextIndex and skip already-attempted models
- If all models in the pool have been attempted, stop and report
- On success, update `state.lastIndex` to the successful index
- Print which model was tried and why it failed on each attempt

## New Files

| File | Responsibility |
|------|---------------|
| `src/lb.js` | Pool CRUD, round-robin pick, failover execution |
| `tests/lb.test.js` | Unit tests for pool logic and round-robin |

### Changes to Existing Files

| File | Change |
|------|--------|
| `src/index.js` | Add `lb` command routing in `parseArgs` and `main()`; add `fleet lb` help text |

## Module API: `src/lb.js`

```js
// Pool CRUD
loadPools()                                    // → { pools: [...] } from models.json
savePools(data)                                // write back to models.json
addPool(name, modelNames)                      // create pool, validate model names exist
deletePool(name)                               // remove pool by name
listPools()                                    // return all pools with resolved model info

// Execution
pickNext(pool)                                 // → { entry, index } using round-robin
runWithFailover(poolName, passthrough, opts)   // pick → spawn → failover loop
```

## Error Handling

- Pool not found: print available pool names, exit 1
- Model profile in pool not found in models.json: warn and skip during execution; during `lb add`, reject invalid names
- Empty pool: error with clear message
- All models failed: print summary table (model name + exit code), exit 1
- models.json read/write errors: propagate with context

## Testing Plan

- `loadPools` / `savePools` — read/write cycle with temp file
- `addPool` — validates model names exist, rejects duplicates, rejects empty name
- `deletePool` — removes correctly, no-op on missing
- `pickNext` — round-robin cycles correctly, handles single-model pool, handles wrap-around
- `runWithFailover` — spawns correct tool, updates state on success, tries next on failure (mocked spawn)

## Future Extensions (out of scope)

- API proxy mode — local HTTP server that transparently load-balances at the API layer
- Weighted round-robin — different models get different traffic shares
- Least-busy strategy — requires observer integration to track active tasks
- Health checks — periodic pings to detect unhealthy models before routing
