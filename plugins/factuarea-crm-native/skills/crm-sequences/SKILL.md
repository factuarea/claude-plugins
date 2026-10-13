---
name: crm-sequences
description: Usa esta skill para consultar, previsualizar, guardar o controlar secuencias CRM de Factuarea y recuperar sus originales, sólo con herramientas MCP nativas actuales y confirmación humana.
---

Aplica primero [el flujo CRM](../crm-native/SKILL.md) y su contrato operativo.
El resource nativo es `automation` singular. Este paquete no envía mensajes,
reproduce pasos ni concede contactabilidad a un sujeto.

| Herramienta | Scope exacto | Argumentos de negocio |
| --- | --- | --- |
| `list_crm_sequences` | `automation:read` | `filters` JSON string, `limit` 1–100; `cursor` opcional |
| `preview_crm_sequence` | `automation:read` | `sequence_id`, `subject_type`, `subject_id`, `start_at` |
| `save_crm_sequence` | `automation:write` | `sequence_id` presente (null al crear), `idempotency_key`, `original_wire` |
| `enrol_crm_sequence` | `automation:write` | `sequence_id`, `idempotency_key`, `original_wire` |
| `pause_crm_enrolment` | `automation:write` | `enrolment_id`, `original_wire` |
| `resume_crm_enrolment` | `automation:write` | `enrolment_id`, `original_wire` |
| `cancel_crm_enrolment` | `automation:write` | `enrolment_id`, `original_wire` |
| `get_crm_sequence_original` | `automation:write` | sólo `idempotency_key` |
| `get_crm_enrolment_original` | `automation:write` | sólo `idempotency_key` |

La metadata nativa `factuarea/requires_confirmation` y el inputSchema actual
pueden exigir `confirmed: true` en mutaciones; SAVE, ENROL y CANCEL necesitan
revisión humana. PAUSE y RESUME también se revisan con el usuario y obedecen
la metadata vigente. No envíes confirmed a una Query original.

`filters` requiere `resource` explícito: `schedules` o `enrolments`. Usa sólo
filtros de su esquema y cursor retornado; no mezcles contadores o scopes de
ambos recursos. Para preview, `subject_type` es `lead`, `opportunity` o
`business_contact`; `subject_id` debe ser el ID original visible de ese tipo.
`start_at` es ISO con offset. La zona IANA, DST, ventanas y políticas se toman
del contrato nativo actual; no calcules un horario que el servidor no aprobó.

Al guardar, el `original_wire` contiene `expected_version` (0 sólo al crear,
positivo al editar) y `definition`. Sus campos nativos son `timezone`,
`ambiguous_offset`, `allowed_windows`, `steps`, `stop_on_closure`, `purpose`,
`channel` y `stop_conditions` opcional. Descubre la estructura de cada campo
en el schema actual; no inventes pasos, canales o consentimientos. En enrol,
el cuerpo es `subject_type`, `subject_id`, `expected_definition_version` actual.
En pause es `expected_version` y `reason: "manual"`; resume y cancel contienen
`expected_version`. Los cuerpos cerrados se conservan como strings originales.

La clave de SAVE/ENROL admite hasta 512 bytes, sin whitespace/control; se
preserva como opaca. El servidor asigna los UUIDs del primer claim. No añadas
UUID de efecto, nuevo enrolment_id o candidato de creación. SAVE/ENROL llaman
su comando una vez y devuelven la Query original autorizada. Con respuesta
ambigua, usa únicamente `get_crm_sequence_original` o
`get_crm_enrolment_original` con esa misma clave y conexión/origen actual.
No recuperes desde preview/head ni reenroles para comprobar si ocurrió.

Los controles no llevan clave de replay ni Query original en este contrato.
Su éxito void sólo confirma el control aceptado. Un 409 exige consultar el
estado actual y revisar una nueva intención humana; nunca reejecución automática.
Si falta el descriptor o tool actual, termina como unavailable; este inventario
Source no activa controles ni la operación de escritura.
