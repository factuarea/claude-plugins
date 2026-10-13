---
name: crm-commercial-journey
description: Usa esta skill para el recorrido nativo Factuarea instalar/descubrir lead→oportunidad→actividad con UUIDs públicos, scopes actuales, confirmación humana y manejo de 409/unconfirmed sin reenviar ni fabricar originales.
---

Lee [crm-native](../crm-native/SKILL.md) y
[la receta literal](../../examples/journey.md#recorrido-literal-instalar-descubrir-lead-oportunidad-actividad).
La procedencia exacta está en [el contrato Source](references/source-contract.json).
Los nombres MCP son los atributos Name actuales, no los nombres WebMCP ni
aliases históricos de rutas. Source, instalación y discovery real son evidencias
separadas; este paquete no enciende las capabilities comerciales.

| Paso | Herramientas MCP exactas | RequiredScope nativo |
| --- | --- | --- |
| Lead prefiscal | `create_lead`, `find_lead` | `crm_leads:write`, `crm_leads:read` |
| Catálogo actual | `list_pipelines`, `get_pipeline` | `crm_pipelines:read` |
| Oportunidad ligada | `create_opportunity`, `get_opportunity` | `crm_opportunities:write`, `crm_opportunities:read` |
| Actividad ligada | `create_crm_activity`, `get_crm_activity`, `list_crm_activities` | `crm_activities:write`, `crm_activities:read` |

Descubre cada nombre y inputSchema en la conexión autenticada actual. La Company,
entorno y scopes se eligen con consentimiento/credencial nativos, nunca en el
body. No añadas role, actor, tenant, company_id, sandbox ni UUID de efecto.
`crm_leads:*` y demás scopes de esta tabla son los RequiredScope de las tools;
no inventes scopes OAuth, grants globales ni equivalencias con WebMCP.
Si faltan descriptor, cualificación, máscara o proveedor, detente unavailable.

Crea el lead sólo tras revisar sus datos declarados y obtener confirmación
humana. Usa source manual si se envía; omite id para que el servidor asigne la
identidad. Guarda una clave opaca estable y los argumentos originales revisados.
El native schema limita la clave de estas familias a 255 caracteres ASCII
imprimibles cuando la define; no extiendas la regla de 512 de secuencias.
`find_lead` recibe el id devuelto por el servidor; email no resuelve identidad,
consentimiento, BusinessContact ni permisos de Opportunity.

Lee el pipeline y sus etapas actuales: elige una etapa activa devuelta dentro
de ese mismo pipeline, con su definition_version/revision y requisitos visibles.
No inventes una etapa predeterminada, un embudo ni valores para campos ocultos.
`create_opportunity` recibe title, lead_id explícito, pipeline_id, stage_id,
amount string decimal y currency ISO; owner_id/team_id sólo si realmente
seleccionados y autorizados. No uses float para Money ni crees un contacto por
email. La conversión Lead→BusinessContact es otra intención y no crea Opportunity.

Tras respuesta nativa confirmada y lectura actual autorizada de la oportunidad,
prepara una actividad dirigida a `target: {type: "opportunity", id: ID_REAL}`.
Esta receta elige note expresamente para registrar la nota revisada: type/title,
target y timezone IANA real son obligatorios; body, owner_id y due_at mantienen
sus valores presentes/omitidos/null según schema. No agregues confirmed ni
original_wire: estas herramientas reciben objetos de argumentos nativos.
El humano confirma antes de cada creación; ese consentimiento no se convierte
en un parámetro desconocido ni sustituye la autoridad del servidor.

`create_crm_activity` devuelve data.state/effect_id/activity_id/activity; sólo
state confirmed anuncia éxito. pending/in_progress/unconfirmed no contienen
una representación exitosa. No confundas activity_id con data.id, ni un
resultado de creación con la lectura get_crm_activity. Una actividad type task
usa el puente canónico a Task; no crees Task adicional. La receta note no crea
Task ni calendario, envía correo o concede contacto comercial.

No hay una Query original MCP dedicada para estas tres creaciones en el catálogo
Source elegido. Ante timeout/unconfirmed conserva key/argumentos y cualquier
UUID factual recibido; detén el siguiente paso. Con ID conocido puedes usar
find_lead/get_opportunity/get_crm_activity para informar estado actual, dejando
claro que no recupera el recibo original. No repitas create ni fabriques un
get_*_original. Si no hay ID, no busques por email/título para afirmar identidad.
Un 409 exige lectura actual, comparación y una nueva revisión humana; conserva
la intención anterior y no cambies su clave para ocultar un conflicto.

[planning.mjs](planning.mjs) sólo prepara argumentos y clasifica recuperación
en memoria. No autentica, concede acceso, descubre servidor ni ejecuta calls.
Sus tests usan UUIDs sintéticos exclusivamente offline; la autoridad y los
snapshots runtime siempre proceden de productores nativos actuales.
