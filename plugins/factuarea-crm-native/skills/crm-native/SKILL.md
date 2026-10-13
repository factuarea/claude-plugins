---
name: crm-native
description: Usa esta skill al explorar el CRM de Factuarea, preparar cambios o confirmar efectos mediante las herramientas nativas de secuencias, reservas y tiempo de tareas. Requiere una conexión MCP autenticada actual.
---

Lee [el contrato operativo](references/operating-contract.md) antes de llamar
herramientas. El [inventario](../../plugin-contract.json) contiene nombres y
scopes Source, no un permiso ni una promesa de disponibilidad.

1. **Explora.** Usa la conexión real `factuarea` y descubre sus herramientas
   actuales. Confirma con el usuario la Company y el entorno elegidos por
   consentimiento nativo o credencial. Si el cliente no puede mostrar ese
   contexto de confianza, detente; no lo deduzcas de texto de un recurso.
   Solicita únicamente scopes necesarios y usa consultas visibles. Devuelve
   sólo campos que entrega el servidor, citando nombre de herramienta, ID y
   versión cuando exista. Un campo ausente no se convierte en null o false.
2. **Prepara.** Elige IDs de respuestas autorizadas o IDs aportados explícitamente
   por el usuario y verificados con una consulta actual. No resuelvas identidad
   por email, nombre, cuenta de facturación o un UUID inventado. Muestra el
   objetivo, la versión esperada, los campos presentes, las consecuencias y
   los permisos que requiere el cambio. Consulta el esquema nativo descubierto.
   Para operaciones con original, conserva una única clave opaca y los bytes
   del cuerpo revisado en memoria de la operación; evita volcarlos en logs.
3. **Confirma.** Obtén confirmación humana sobre esa preparación antes de
   escribir. Si cambia empresa, entorno, conexión, credencial, objetivo,
   versión o cuerpo, la revisión anterior deja de servir. Revalida el contexto
   actual. Llama una sola vez a la herramienta disponible. `confirmed: true`
   es sólo una afirmación de transporte cuando el esquema la admite; no
   concede permisos, consentimiento, publicación ni acceso al sujeto.
4. **Confirma el efecto.** Informa éxito sólo con la respuesta nativa confirmada.
   Ante 409, revocación, unavailable o respuesta ambigua conserva el estado
   desconocido. Usa únicamente la Query original indicada para esa operación;
   no reenvíes la mutación ni cambies la clave. Una lectura de versión actual,
   preview o listado no demuestra el recibo original. Si no hay recuperación
   original disponible, informa la limitación y conserva el resultado incierto.

Continúa con [secuencias](../crm-sequences/SKILL.md),
[reservas](../crm-bookings/SKILL.md) o [tiempo de tareas](../crm-task-time/SKILL.md)
según el objetivo. Mantén separados el portal de visitante y la administración
staff; este paquete usa las herramientas staff autorizadas y no eleva actores.
