# 🧠 TEMPLATE DE ORQUESTRACIÓN MULTI-AGENTE (WORKTREE EXECUTION SYSTEM)

Este documento define la estrategia de paralelización de tareas utilizando **Git Worktrees** para aislar el contexto de 3 sub-agentes de IA operando de forma concurrente, asíncrona y sin conflictos de código.

---

## 👥 MATRIZ DE CAPACIDADES DE LOS AGENTES
*   **Agente 1 (Antigravity CLI - `agy`):** Especialista en lógica de backend, refactorizaciones complejas de arquitectura, algoritmos puros y tareas que requieran validación estricta paso a paso.
*   **Agente 2 (Claude Code - `claude`):** Especialista en análisis de código existente, creación de suites de pruebas unitarias/integración, depuración profunda de errores y lógica de negocio intermedia.
*   **Agente 3 (Codex / OpenAI CLI):** Especialista en maquetación de interfaces de usuario (UI), generación de componentes frontend aislados basados en el sistema de diseño local y código boilerplate masivo.

---

## 🛠️ INSTRUCCIONES ESTRICTAS PARA EL CEREBRO ORQUESTADOR

Si eres el **Cerebro Orquestador** (Antigravity, Claude o Codex en control del flujo), tu primera directiva es **localizar y leer el archivo de Markdown externo** especificado por el usuario que contiene el backlog de tareas (ej: `BACKLOG.md`, `SPRINT.md`, etc.). Una vez leído, ejecuta los siguientes pasos analíticos:

1.  **Extracción y Validación de Independencia:** Analiza la lista de requerimientos del archivo externo. Elige exactamente **3 tareas** que sean **completamente disjuntas** (que operen en carpetas o archivos independientes). Si existe un único punto de contacto inevitable (ej: el Router del sistema o un archivo de indexación), regístralo explícitamente como un *Punto de Fusión Trivial*.
2.  **Asignación Inteligente:** Empareja cada una de las 3 tareas extraídas con el sub-agente más apto según la *Matriz de Capacidades*.
3.  **Pregunta antes de Actuar:** Si encuentras alguna ambigüedad técnica, dependencias ocultas entre las tareas elegidas, o si faltan rutas de archivos clave en el archivo de backlog, detente e **interroga al usuario sobre tus dudas**.

---

## ⚡ PROTOCOLO DE GENERACIÓN Y EJECUCIÓN DIRECTA (BASH)

Una vez resueltas las dudas con el usuario, tu objetivo final es **generar y ejecutar inmediatamente** un script en segundo plano llamado `.antigravity_orchestrate.sh` en la raíz del repositorio. El script debe estructurarse con este diseño exacto, inyectando dinámicamente los nombres de las ramas y los prompts detallados que diseñes para resolver las tareas del archivo externo:

```bash
#!/bin/bash
set -e

echo "🚀 [Cerebro] Iniciando flujo de orquestación paralela automatizada..."

# 1. Creación segura de directorios temporales
mkdir -p .worktrees

# 2. Inicialización de los 3 Git Worktrees con sus respectivas ramas
git worktree add .worktrees/agy-agent -b feature/agy-task-branch
git worktree add .worktrees/claude-agent -b feature/claude-task-branch
git worktree add .worktrees/codex-agent -b feature/codex-task-branch

# 3. Enlace de dependencias (Evita duplicación masiva de node_modules en disco)
ln -s "$(pwd)/node_modules" "$(pwd)/.worktrees/agy-agent/node_modules" || true
ln -s "$(pwd)/node_modules" "$(pwd)/.worktrees/claude-agent/node_modules" || true
ln -s "$(pwd)/node_modules" "$(pwd)/.worktrees/codex-agent/node_modules" || true

echo "🤖 [Cerebro] Despachando sub-agentes de forma concurrente..."

# 4. Lanzamiento asíncrono en segundo plano utilizando operadores '&'
(cd .worktrees/agy-agent && agy "[Prompt específico de backend basado en la tarea del backlog externo]") &
PID_AGY=$!

(cd .worktrees/claude-agent && claude task "[Prompt específico de lógica/tests basado en la tarea del backlog externo]") &
PID_CLAUDE=$!

(cd .worktrees/codex-agent && openai api completions.create ... > [Ruta_Destino_Boilerplate]) &
PID_CODEX=$!

echo "⏳ [Cerebro] Monitoreando procesos. Esperando finalización..."
wait $PID_AGY && echo "✅ Sub-agente Antigravity terminó su tarea con éxito."
wait $PID_CLAUDE && echo "✅ Sub-agente Claude Code terminó su tarea con éxito."
wait $PID_CODEX && echo "✅ Sub-agente Codex terminó su tarea con éxito."

echo "🧹 [Cerebro] Iniciando fase de Teardown y limpieza de disco..."

# 5. Confirmación automática de cambios en cada entorno aislado
git -C .worktrees/agy-agent add . && git -C .worktrees/agy-agent commit -m "feat(agy): automatización finalizada por el sub-agente" || true
git -C .worktrees/claude-agent add . && git -C .worktrees/claude-agent commit -m "feat(claude): pruebas y lógica integradas" || true
git -C .worktrees/codex-agent add . && git -C .worktrees/codex-agent commit -m "feat(codex): UI y componentes completados" || true

# 6. Destrucción física segura de los entornos de trabajo (las ramas quedan intactas en Git)
git worktree remove .worktrees/agy-agent --force
git worktree remove .worktrees/claude-agent --force
git worktree remove .worktrees/codex-agent --force

echo "🎉 [Cerebro] Orquestación concluida. Las 3 ramas están listas para revisión manual o merge final."