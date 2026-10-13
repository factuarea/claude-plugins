---
description: Revisar una conversión de lead, permisos documentales o recuperar una intención CRM confirmada con el MCP conectado
argument-hint: [conversión, concesión, revocación o recibo original]
---

Lee `${CLAUDE_PLUGIN_ROOT}/skills/factuarea-crm/SKILL.md` y
`${CLAUDE_PLUGIN_ROOT}/skills/factuarea-crm/references/continuity.md`.

Continúa la solicitud `$ARGUMENTS` con la conexión Factuarea que ya administra
el host. Agota el discovery actual antes de ofrecer cada paso. Presenta el plan
nativo o el documento y la concesión exacta antes de pedir confirmación de una
escritura. Conserva clave, versión, hash y payload de la intención confirmada.

Una respuesta incierta requiere observación del dueño; no reenvíes la escritura,
no generes otra clave ni deduzcas éxito de un listado. No interpretes el discovery
como una concesión de permisos. La recuperación sólo corresponde a un efecto
confirmado previamente y sigue sujeta a la autoridad actual del servidor.

El helper es un módulo opcional para adaptadores del host; este comando no lo
instala ni crea otro cliente, servidor o flujo OAuth. Si no está integrado,
ejecuta los mismos pasos con las tools nativas expuestas por el host y conserva
la evidencia pendiente cuando no exista un contrato seguro de recuperación.
