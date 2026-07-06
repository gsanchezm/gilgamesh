# 🧠 ORCHESTRATION PLAN — MULTI-AGENT WORKTREE EXECUTION SYSTEM (v2)

Este documento define la estrategia de paralelización de tareas utilizando **Git Worktrees**
para aislar el contexto de **N sub-agentes de IA** (recomendado: 3–5) operando de forma
concurrente, asíncrona y sin conflictos de código, junto con el **protocolo de revisión
automatizada** que reduce la revisión humana al subconjunto de cambios de alto riesgo.

**Principios rectores:**
1. **THE KEYSTONE WINS.** Ningún agente inventa nombres, entidades o rutas fuera de
   `specs/_keystone/`. Los cambios al keystone se hacen en serie, antes de paralelizar.
2. **Un slice vertical = una tarea paralelizable.** Dos agentes nunca trabajan el mismo slice.
3. **Un agente nunca aprueba su propio trabajo**, y ningún agente aprueba cambios de alto riesgo.
4. **El límite de escala no es Git, es la revisión humana.** Este plan la minimiza, no la elimina.

---

## 👥 MATRIZ DE CAPACIDADES DE LOS AGENTES

- **Antigravity CLI (`agy`)**: lógica de backend, refactorizaciones de arquitectura,
  algoritmos puros, validación estricta paso a paso.
- **Claude Code (`claude`)**: análisis de código existente, suites de pruebas
  unitarias/integración, depuración profunda, lógica de negocio intermedia.
- **Codex CLI (`codex`)**: maquetación de UI, componentes frontend aislados basados en el
  sistema de diseño local, boilerplate masivo.

La matriz define *aptitudes*, no cupos: pueden lanzarse 2 instancias del mismo CLI en
worktrees distintos si el backlog lo amerita (ej. dos slices de backend disjuntos → dos
sesiones de `claude`). Si un proveedor limita por rate limits, preferir instancias del
CLI que no esté saturado.

---

## 🛠️ INSTRUCCIONES ESTRICTAS PARA EL CEREBRO ORQUESTADOR

Si eres el **Cerebro Orquestador**, tu primera directiva es localizar y leer el archivo
Markdown externo especificado por el usuario con el backlog (ej: `BACKLOG.md`). Luego:

1. **Extracción y Validación de Independencia:** Elige entre **2 y N tareas** (N lo define
   el usuario; default 3) que sean **completamente disjuntas** — que operen en carpetas,
   paquetes o slices independientes. Criterio práctico en este repo: *un slice vertical =
   una tarea paralelizable*. Si existe un punto de contacto inevitable, regístralo como
   **Punto de Fusión** e inclúyelo en el Plan de Integración (paso 5).
2. **REGLA DEL KEYSTONE (no negociable):** Ninguna tarea que requiera **modificar**
   `specs/_keystone/` es paralelizable — los cambios al keystone se hacen ANTES, en serie,
   en la rama principal, y los worktrees se crean después. Todo prompt de sub-agente DEBE
   comenzar con: *"Read `specs/_keystone/foundation-vocabulary.md` first. THE KEYSTONE
   WINS: do not invent names, entities, or routes outside it. If the task seems to require
   a new name, STOP and report it instead of inventing it."*
3. **Asignación Inteligente:** Empareja cada tarea con el sub-agente más apto según la
   Matriz de Capacidades.
4. **Pregunta antes de Actuar:** Ante ambigüedad técnica, dependencias ocultas entre las
   tareas elegidas, o rutas faltantes en el backlog, detente e interroga al usuario.
5. **Plan de Integración:** Antes de lanzar, declara el **orden de merge** de las ramas y
   quién resuelve cada Punto de Fusión (normalmente: merge secuencial a main con re-test
   entre cada uno; el punto de fusión lo integra el orquestador o el usuario, nunca dos
   agentes en paralelo).
6. **Reporte final obligatorio:** cada prompt de sub-agente termina con *"End with a
   summary: files touched, commands run, test results, and anything you could not
   complete."* — acelera la revisión posterior.

---

## ⚡ PROTOCOLO DE GENERACIÓN Y EJECUCIÓN DIRECTA (BASH)

Resueltas las dudas, genera y ejecuta `.antigravity_orchestrate.sh` en la raíz del repo.
El script se genera dinámicamente para N tareas siguiendo este diseño exacto:

```bash
#!/bin/bash
set -euo pipefail

RUN_ID=$(date +%Y%m%d-%H%M%S)
LOG_DIR=".worktrees/logs/$RUN_ID"
mkdir -p "$LOG_DIR"

# ── Teardown seguro: se ejecuta SIEMPRE, incluso si un agente falla ──
cleanup() {
  echo "🧹 [Cerebro] Teardown de worktrees (las ramas quedan intactas)..."
  for wt in .worktrees/task-*; do
    [ -d "$wt" ] && git worktree remove "$wt" --force || true
  done
}
trap cleanup EXIT

# ── Quality gate: nada se comitea si no pasa ──
# Ajustar comandos al monorepo (pnpm -w, turbo, etc.)
quality_gate() {
  local dir=$1
  (cd "$dir" && pnpm lint && pnpm typecheck && pnpm test) \
    > "$LOG_DIR/$(basename "$dir")-gate.log" 2>&1
}

# ── Por cada tarea i (nombres de rama únicos y descriptivos) ──
# git worktree add .worktrees/task-<slug> -b feat/<slug>-$RUN_ID
# ln -s "$(pwd)/node_modules" ".worktrees/task-<slug>/node_modules" || true
#   ⚠️ El symlink de node_modules solo es válido si la tarea NO toca package.json.
#   Si la tarea modifica dependencias, ese worktree debe hacer su propio install.

echo "🤖 [Cerebro] Despachando sub-agentes (logs en $LOG_DIR)..."

# ── Lanzamiento asíncrono, cada agente con su log ──
# (cd .worktrees/task-<slug> && claude -p "<PREÁMBULO KEYSTONE + prompt de la tarea>") \
#     > "$LOG_DIR/task-<slug>.log" 2>&1 &
# PIDS+=($!); SLUGS+=("task-<slug>")
#
# Codex se invoca con el CLI actual:
# (cd .worktrees/task-<slug> && codex exec "<PREÁMBULO KEYSTONE + prompt>") \
#     > "$LOG_DIR/task-<slug>.log" 2>&1 &

# ── Espera tolerante a fallos: un agente caído no mata a los demás ──
FAILED=()
for i in "${!PIDS[@]}"; do
  if wait "${PIDS[$i]}"; then
    echo "✅ ${SLUGS[$i]} terminó."
  else
    echo "❌ ${SLUGS[$i]} FALLÓ — ver $LOG_DIR/${SLUGS[$i]}.log"
    FAILED+=("${SLUGS[$i]}")
  fi
done

# ── Commit SOLO si el quality gate pasa; mensaje ligado a la tarea ──
for slug in "${SLUGS[@]}"; do
  wt=".worktrees/$slug"
  if [[ " ${FAILED[*]:-} " == *" $slug "* ]]; then
    echo "⏭️  $slug: sin commit (el agente falló)."
    continue
  fi
  if quality_gate "$wt"; then
    git -C "$wt" add -A
    git -C "$wt" commit -m "feat($slug): <descripción real de la tarea> [agent-run $RUN_ID]"
    echo "✅ $slug: gate OK, commit hecho."
  else
    echo "🚫 $slug: FALLÓ el quality gate — SIN commit. Revisar $LOG_DIR/$slug-gate.log"
  fi
done

echo "🎉 [Cerebro] Orquestación concluida. Ramas listas para el Review Protocol."
```

### Reglas del script (para el orquestador que lo genera)

1. **Ramas**: `feat/<slug>-$RUN_ID`. Nunca nombres fijos — las corridas repetidas no deben chocar.
2. **Sin commit ciego**: el commit ocurre únicamente si lint + typecheck + tests pasan en el
   worktree. Un gate rojo deja la rama sin commit y el log señala por qué.
3. **Mensajes de commit reales**: describen la tarea, no "automatización finalizada".
4. **Logs por agente**: nada de salida entrelazada en la terminal; todo a `$LOG_DIR`.

---

# 🔍 REVIEW PROTOCOL — Revisión automatizada con enrutamiento por riesgo

Toda rama que sale del protocolo anterior entra a este pipeline. Objetivo: reducir la
revisión humana al subconjunto de cambios de alto riesgo, sin ceder la aprobación
autónoma total.

## Las 4 capas

```
Rama del sub-agente
   │
   ▼
[Capa 0] Quality gate mecánico (lint + typecheck + tests)     → rojo = sin commit (arriba)
   │
   ▼
[Capa 1] Clasificador de riesgo (git diff --name-only)        → LOW_RISK | HUMAN_REQUIRED
   │
   ├─ HUMAN_REQUIRED ──────────────► cola de revisión humana (con el reporte del reviewer como insumo)
   │
   ▼ LOW_RISK
[Capa 2] Reviewer agent (modelo cruzado, worktree limpio)     → APPROVE | REQUEST_CHANGES
   │
   ├─ REQUEST_CHANGES ─► vuelve al agente autor (máx 2 rondas; a la 3ª → humano)
   │
   ▼ APPROVE
[Capa 3] Merge queue secuencial con re-test tras cada merge   → main
```

## Capa 1 — Clasificador de riesgo (determinista, sin IA)

Rutas protegidas: si el diff toca cualquiera, la rama es **HUMAN_REQUIRED** sin importar
lo que opine el reviewer.

```bash
PROTECTED_PATHS=(
  "specs/_keystone/"        # vocabulario congelado — siempre humano
  "packages/domain/"        # entidades compartidas por todos los slices
  "**/migrations/"          # esquema de DB — irreversible en la práctica
  "**/auth/**"              # RBAC, sesiones, multi-tenancy
  "**/*billing*"            # dinero
  ".github/workflows/"      # el CI que valida todo lo demás
  "*.env*" "**/secrets*"    # credenciales
)

classify_risk() {
  local branch=$1
  local files; files=$(git diff --name-only main..."$branch")
  for f in $files; do
    for p in "${PROTECTED_PATHS[@]}"; do
      # shellcheck disable=SC2053
      [[ $f == $p || $f == ${p%/}/* ]] && { echo "HUMAN_REQUIRED"; return; }
    done
  done
  echo "LOW_RISK"
}
```

Regla adicional de alcance: si la rama del slice X tocó archivos del slice Y →
**HUMAN_REQUIRED** (el agente se salió de su carril; eso nunca se auto-aprueba).

## Capa 2 — Reviewer agent

**Reglas duras:**
- **Modelo cruzado:** el reviewer es un CLI/modelo distinto al autor
  (Claude Code escribió → Codex revisa; Codex escribió → Claude Code revisa).
- **Worktree limpio:** el reviewer hace checkout de la rama en un worktree nuevo,
  sin acceso al historial de conversación del autor. Revisa el código, no la intención.
- **Debe ejecutar, no solo leer:** corre los tests él mismo y al menos un escenario
  del slice de punta a punta si es posible.
- **Salida estructurada obligatoria** (JSON) para que el script decida sin parsear prosa.

**Prompt del reviewer (plantilla):**

```
You are a code reviewer for the Gilgamesh repo. You did NOT write this code.
Your job is to find reasons to reject it, not to be agreeable.

Read first: specs/_keystone/foundation-vocabulary.md and the slice spec at <SPEC_PATH>.

Then review branch <BRANCH> (already checked out here) against this rubric:

1. KEYSTONE: Does it introduce any entity, route, field, or name not in the keystone?
   Any violation = REQUEST_CHANGES, no exceptions.
2. SPEC FIDELITY: Does the implementation match the slice spec and its .feature files?
   List any scenario in the .feature files not covered by a real test.
3. TEST QUALITY: Are the tests tautological (asserting what the code does rather than
   what the spec requires)? Pick the 2 most important behaviors and verify a test would
   FAIL if that behavior broke. If you cannot tell, run the tests with a deliberate
   small mutation and check they catch it.
4. SCOPE: List every file touched outside the slice's own directories.
5. TENANT SAFETY: Any query or handler missing orgId scoping?
6. Run: pnpm lint && pnpm typecheck && pnpm test. Include real output summaries.

Output ONLY this JSON:
{
  "verdict": "APPROVE" | "REQUEST_CHANGES",
  "keystone_violations": [...],
  "uncovered_scenarios": [...],
  "tautological_tests": [...],
  "out_of_scope_files": [...],
  "tenant_safety_issues": [...],
  "commands_run": [...],
  "summary_for_human": "3-5 lines a human can read in 20 seconds"
}
```

**Límite de rondas:** máximo 2 ciclos REQUEST_CHANGES → corrección. Al tercero, la rama
pasa a revisión humana con ambos reportes adjuntos (evita bucles infinitos agente-agente).

## Capa 3 — Merge queue

Los APPROVE de bajo riesgo no se mergean en paralelo:

```
por cada rama aprobada, en el orden del Plan de Integración:
  merge a main → correr suite completa en main → si rojo: revert automático + HUMAN_REQUIRED
```

Dos ramas verdes por separado pueden romper combinadas; el re-test tras cada merge es lo
que hace seguro el auto-merge.

## Lo que queda para el humano (por diseño, no por falta de automatización)

| Siempre humano | Por qué |
|---|---|
| Cambios al keystone | Es la constitución del repo; un agente no decide vocabulario |
| Migraciones de DB | Difíciles de revertir en producción |
| Auth / RBAC / tenancy | El costo de un falso APPROVE es una fuga entre orgs |
| Billing | Dinero |
| 3ª ronda de REQUEST_CHANGES | Dos agentes en desacuerdo = juicio humano |
| Ramas fuera de alcance | Un agente que se salió de su slice rompió el contrato |

## Calibración

Las primeras 2-3 semanas, **auditar también las auto-aprobadas** (muestreo: 1 de cada 3).
Si aparece un APPROVE que el humano habría rechazado, endurecer la rúbrica o mover esa
categoría de archivos a PROTECTED_PATHS. El sistema se calibra con rechazos reales, no
con confianza a priori.

---

# 📈 ESCALAR MÁS ALLÁ DE 3 AGENTES

- **El límite no es Git, es la revisión humana.** Subir de 3 a 4–5 solo si las ramas
  HUMAN_REQUIRED no se acumulan sin revisar.
- **Slices como unidad de paralelismo**: los slices verticales son la frontera natural
  de disyunción. Dos agentes nunca trabajan el mismo slice.
- **Cambios al keystone se serializan siempre** (regla 2 del orquestador). Es el único
  archivo compartido por diseño; tratarlo como punto de fusión paralelo garantiza conflictos.
- **Rate limits**: N sesiones simultáneas de CLIs de IA consumen cuota en paralelo; la
  matriz define aptitudes, no cupos — usar más instancias del CLI menos saturado es válido.

---

# 📋 REGISTRO DE SLICES (la unidad de paralelización)

Un slice vertical = una tarea paralelizable (regla 1). Estado + dependencias de orquestación:

| # | Slice | Estado | Dependencias / notas de orquestación |
|---|-------|--------|--------------------------------------|
| 01 | Auth + Onboarding + Agent room | DONE (`main`) | — |
| 02 | Test Lab authoring | DONE (`main`) | `AgentBrainPort` = stub determinista |
| 03 | Test execution + results | DONE (`main`) | `TestKernel` = `DeterministicKernel`; ejecución real → Orchestration (§7 `BLOCKED-UNTIL-DELIVERED`) |
| 04 | Subscription & billing | DONE (`main`) | `PaymentProvider` = mock; migrado al modelo 4-tier |
| 05 | Knowledge / RAG | DONE (`main`) | corpus global compartido + upload per-org (slice 7) |
| 06 | Integrations | DONE (`main`) | `MockRepoProvider` + `StubSecretVault` |
| 07 | Look & feel | DONE (`main`) | vistas nuevas pesadas pendientes (Orchestration, Chat UI, Session) |
| 12 | **Auth recovery** | DONE (`main`) | Keystone v0.4 (PasswordReset/EmailPort). BDD 141 · anti-enumeración · token single-use sha256. |
| 11 | **Chat re-skin (captura 07)** | DONE (`main`, screenshot aprobado por owner) | Rutas v0.4 (rail+historial) · EventSource vivo · pinned desde tile. BDD 160/1318 · Playwright 18. |
| 10 | **Billing 4-tier (formalización)** | DONE (`main`) | Spec+BDD sobre la semántica ya viva (`7632020`); domain deriva de `PLAN_CATALOG`. BDD 148. |
| — | feat-byok-live · feat-ci-hardening | DONE (`main`) | BYOK call-time (`forOrg`) · Actions a SHA + assets −972 KB. |
| 09 | **Brain (adapter Claude real)** | DONE (`main`, merge FF tras review adversarial de 3 ángulos + 6 fixes; `d8f2516`) | Keystone **v0.3** aplicado en serie en `main` (`214f94b`). Verificado post-merge: typecheck + lint · 570 unit/e2e Docker-free · `test:int` 19 · **BDD 133 escenarios / 1063 steps** · Playwright 17. `ClaudeBrain` real detrás de `SelectingBrain` (`BRAIN_MODE=offline` o sin `ANTHROPIC_API_KEY` → stub; CI/BDD siempre offline). Metering `BrainUsage` incondicional + vista de uso · BYOK `anthropic` (S6 pattern) · tool registry · C3 SSE vivo (`?live=1`). Follow-ups en `decisions-log.md` (BYOK call-time vía `SecretVault.get()`, EventSource en el cliente web, embeddings semánticos, cobro de tokens). |
| 08 | **Agent Chat (text)** | DONE (`main`, merge FF `a3b7284` tras review adversarial de 8 ángulos + 7 fixes) | Keystone **v0.2** aplicado en serie en `main` (`933769d`) antes del worktree (regla 2). Verificado post-merge: typecheck + lint · 504 unit/e2e Docker-free · `test:int` 19 · **BDD 112 escenarios / 896 steps** · Playwright 15. Brain = `DeterministicBrain` (canned por slot) → **respuestas reales + SSE vivo bloqueados hasta el adapter Claude de `AgentBrainPort`** (Brain slice). `enqueue_run` va por la vía estándar (quota/RBAC/audit) contra `DeterministicKernel` → **ejecución real de tools bloqueada hasta chaos-proxy + plugin Playwright** (§7). Follow-ups del review en `decisions-log.md`. |