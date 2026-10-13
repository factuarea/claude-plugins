---
name: crm-bookings
description: Usa esta skill para administrar servicios de reservas de Factuarea, leer servicios/reservas actuales, preparar cambios con CAS y recuperar recibos originales sin reenviar. Requiere herramientas staff MCP actuales.
---

Aplica [el flujo CRM](../crm-native/SKILL.md). Mantén separado el visitante del
widget público: las siguientes herramientas administran servicios con autoridad
staff, no crean ni confirman una reserva de visitante por sí mismas.

| Herramienta | Scope exacto | Entrada |
| --- | --- | --- |
| `list_booking_services` | `booking:read` | `cursor`, `limit` opcionales (1–100) |
| `list_bookings` | `booking:read` | `cursor`, `limit`, `service_id`, `host_id`, `status`, `from`, `through` según schema |
| `get_booking_service` | `booking:read` | `id` del servicio actual |
| `save_booking_service` | `booking:write` | `id` sólo al editar, `idempotency_key`, `original_wire_body`, `confirmed: true` |
| `recover_booking_service_receipt` | `booking:write` | mismo `id` original si existía, misma clave y `original_wire_body`, sin confirmed |

`status` admite held/confirmed/cancelled/expired. `from` y `through` son UTC
con segundos y Z; el cursor es el que devuelve la página autorizada. Servicios,
recursos y reservas usan UUID v7; el host puede usar UUID v4/v7 del esquema
real. Para crear se omite `id`: no envíes null ni generes un ID. Para editar,
lee `get_booking_service` y conserva su versión actual antes de preparar.

El cuerpo original tiene `definition`, `expected_version` (null/omitido sólo
al crear, positivo al editar) y `publication_confirmation_id` cuando el flujo
nativo de publicación lo requiere. Nunca inventes esa confirmación, un recurso,
un host ni una aprobación. `confirmed: true` es insuficiente para publicar.
Si la interfaz nativa no entrega opciones o la prueba requerida, detente y
solicita que el usuario complete el flujo nativo; no rebajes state para eludirlo.

Los nombres públicos de definición son `public_id`, `state`, `host_id`,
`resource_id`, `schedule`, `required_sources`, `notice_version`, `hold_minutes`
y `location`, según el schema actual. `required_sources` incluye `booking`
y todas las fuentes configuradas/aprobadas necesarias. No inventes defaults.
Una fuente unavailable no significa libre; las fechas de Task no son freebusy.

El schedule exige política completa: `timezone` IANA, `dst_policy`, ventanas,
excepciones, duración, buffers, capacidad, antelación, horizonte y paso. Son
horarios aprobados explícitos del usuario y configuración nativa; una ausencia
no se trata como disponibilidad vacía. Presenta días locales y DST tal como
los define el servidor. Un update omitido conserva el campo; null explícito
sólo limpia los campos que el schema permite (por ejemplo location). No rellenes
campos privados ocultos ni cambies otros valores para completar el patch.

Conserva la clave original opaca (máximo 200) y los bytes exactos del cuerpo
JSON (máximo 65536). El servidor asigna la primera identidad y mantiene el
recibo original. Ante timeout/unconfirmed, consulta
`recover_booking_service_receipt` con el objetivo, clave y cuerpo originales.
Una respuesta null no prueba ausencia de efecto. Nunca guarda de nuevo para
recuperar, ni usa `get_booking_service` como recibo. Para resolver CAS 409,
lee el head actual separado y prepara otro cambio revisado por el usuario.
