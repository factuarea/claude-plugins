---
name: crm-task-time
description: Usa esta skill al consultar o imputar tiempo canónico a tareas de Factuarea, gestionar el temporizador del titular de la credencial o editar/borrar entradas mediante sus herramientas MCP actuales.
---

Aplica [el flujo CRM](../crm-native/SKILL.md). Estas herramientas pertenecen a
Task; no sustituyen tareas, no crean actividades paralelas y no son fichajes
laborales del catálogo `time_entries:*`. Las fechas de Task no prueban
ocupación ni disponibilidad de reservas.

| Herramienta | Scope | Entrada |
| --- | --- | --- |
| `list_task_time_entries` | `tasks:read` | `task_id`; `limit` 1–100 y `starting_after` opcionales |
| `get_task_time_entry` | `tasks:read` | `task_id`, `time_entry_id` |
| `get_running_task_timer` | `tasks:read` | sin argumentos de negocio |
| `create_task_time_entry` | `tasks:write` | `task_id`, `started_at`, `ended_at`; `description`, `billable` opcionales |
| `update_task_time_entry` | `tasks:write` | `task_id`, `time_entry_id`; sólo los campos a cambiar |
| `start_task_timer` | `tasks:write` | sólo `task_id` |
| `stop_task_timer` | `tasks:write` | sin argumentos de negocio |
| `delete_task_time_entry` | `tasks:delete` | `task_id`, `time_entry_id`, `idempotency_key` nativa requerida |

Usa IDs v7 de Task y entrada reales. El cursor `next_cursor` retornado se pasa
como `starting_after`; no lo fabriques a partir de una entrada de otra tarea.
El listado puede mostrar entradas de cualquier autor dentro de permisos,
pero create/start actúan como el titular de la credencial actual. No envíes
actor, rol, user_id, empresa, factura ni campo de grants.

Una imputación cerrada requiere inicio y fin ISO con zona/offset, fin no anterior
al inicio, duración máxima 24h e inicio no más de un día en el futuro. Muestra
la duración y la condición facturable al revisar; el default nativo de billable
es true sólo cuando se omite. description tiene máximo 1000 caracteres.

En update sólo viajan campos presentes. Ausencia conserva valor; description
null la borra. started_at y billable no admiten null. No retires el fin de una
entrada cerrada; una entrada en marcha sólo admite description/billable.
`task_time_entry_invoiced` impide editar/borrar: no borres una factura para
eludirlo. Los errores de periodo o de Task ajena no autorizan normalizar datos.

Consulta `get_running_task_timer` antes de iniciar o detener. Un temporizador
pertenece al titular y Company actuales. `task_timer_already_running` preserva
el original: consúltalo, no lo reemplaces automáticamente. Stop cierra el
actual y devuelve sus datos; `task_timer_not_running` no inicia uno nuevo.

Todas las escrituras necesitan revisión humana. Delete es irreversible y sólo
admite el canal API key autorizado por el servidor, con tasks:delete y clave
nativa. No amplíes scopes OAuth ni cambies canal para eludir una denegación.
El inputSchema descubierto define cualquier metadata/clave adicional; no
inventes un campo confirmed donde no existe.

No existe Query original de tiempo Task en el inventario de este paquete.
Ante respuesta ambigua, conserva la incertidumbre, no crees otra entrada,
no generes nueva clave ni reinicies/detengas automáticamente. Puedes consultar
una entrada conocida o el temporizador actual para informar estado, indicando
que esa lectura no es un recibo original del comando.
