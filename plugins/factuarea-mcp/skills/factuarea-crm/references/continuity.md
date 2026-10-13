# Continuación CRM con autoridad actual

Usa `/factuarea-mcp:crm-continue` para conversión, concesiones documentales y
recuperación de un recibo original. Aplica también el [skill CRM](../SKILL.md).
Sólo ofrece una operación cuando esté en el `tools/list` actual completo; sus
anotaciones y presencia no acreditan un scope, permiso de registro, plan ni
productor. Si un paso falta, explica cuál falta y conserva el trabajo preparado.

El módulo [crm-journey.mjs](../scripts/crm-journey.mjs) compone el preflight
existente. Un adaptador puede proporcionarle `listTools` y `callTool` ligados al
mismo cliente que ya conectó el host. No abre HTTP ni OAuth, guarda credenciales,
instala un hook o publica un catálogo. Invalida la sesión con `tools/list_changed`,
reconexión, cambio de empresa/actor/entorno, retirada de consentimiento o política.
Los tokens de preparación sólo sirven dentro de esa sesión y no se importan
desde una conversación o un fichero. No persistas sus datos como permisos.

## Conversión del lead

1. Descubre `preview_lead_conversion` y `convert_lead`. El preview es de lectura
   pero su contrato exige `crm_leads:write`; una credencial de lectura no concede
   conversión. Captura el lead con `create_lead`, nunca con el alias `create_client`.
2. Elige explícitamente `strategy: link_existing` y `business_contact_id` con
   `role_action: preserve` o `assign`; la asignación requiere `role`, y la
   activación tiene su propio permiso nativo. Para `create_contact`, proporciona
   `contact` y sus `roles` explícitos. No completes CIF, roles ni perfiles por
   intuición. El dueño de BusinessContact conserva identidad y fiscalidad.
3. Lee el preview con el payload original. Presenta `lead_version`, `contact_id`,
   `normalized_draft`, `roles_before`, `roles_after`, `conflicts` y `plan_hash`.
   Las dos listas de roles son datos del plan, no permiso para modificarlas.
4. Confirma ese plan con el usuario. El helper vuelve a leer el mismo preview;
   si cambia cualquier dato, requiere otra revisión. No sustituye el plan ni su
   versión silenciosamente. Con conflictos, no prepara la conversión.
5. Envía `convert_lead` con el payload revisado más `expected_version` del
   `lead_version`, `plan_hash`, `confirmed: true` y una clave de la intención.
   La ejecución revalida la autoridad y el CAS nativos. Un 409 requiere leer y
   revisar; no edites el payload de la clave anterior ni conviertas de nuevo.

## Concesiones y documentos

Lee `get_commercial_document` con la autoridad actual. Para compartir, usa su
`version` como `expected_version`, `grant_type: user|team`, el UUID nativo del
destinatario y `expires_at` sólo si se solicita. No crees un destinatario local.
Una asociación con oportunidad o ticket no concede acceso al documento.

Para revocar, selecciona un `shares[].id` actualmente visible y activo
(`revoked_at: null`). El recibo de escritura `{id, version}` identifica el
documento; no identifica la concesión. Si la máscara omite `shares`, no infieras
su existencia ni derives el UUID desde la clave. `prepareDocumentGrant` y
`prepareDocumentRevocation` usan una lectura nueva antes de preparar el CAS.

Carga y sustitución documental requieren un `producer_reference_id` nativo y
`claimed_mime`; no aceptan base64 ni un blob inventado. Oportunidad y ticket usan
sus contratos separados: la versión de asociación, documento, oportunidad y
ticket no es intercambiable. Usa UUID, null y decimales de las respuestas nativas
y los cursores del schema de cada tool. Consulta los [contratos actuales](operations.md).

## Recuperar la intención original

`execute` devuelve la respuesta MCP nativa íntegra. Sólo interpreta como
confirmación los contratos de escritura verificados que devuelven identidad y
versión, o el recibo nativo `confirmed: true, representation_available: false`.
Actividad tiene su recibo propio: `state: confirmed`, `activity_id` y `effect_id`
distintos, con `activity` actualmente visible o null; no se convierte en `{id,version}`.
Un HTTP correcto, `isError`, `pending`, `in_progress`, texto libre o un objeto
sin el contrato no confirman un efecto. Identidad confirmada sin representación
no autoriza leer los datos ni revelar el contacto.

`recoverConfirmed(preparation)` requiere que esta misma sesión haya observado
el resultado confirmado. Es una petición explícita con el mismo nombre, clave
y argumentos originales, incluidos versiones, plan hash y null. Descubre de
nuevo el descriptor completo y bloquea si cambió. El servidor conserva el
recibo/effect original y revalida permisos actuales; el cliente nunca envía el
marcador privado `_meta['io.factuarea/confirmed-identity']` ni el atributo interno
`factuarea.idempotency.confirmed_identity`.

El recibo documental recuperado conserva su versión original, aunque una lectura
actual tenga otra. Los owners de Lead y otras entidades pueden devolver su
representación actual autorizada o una identidad sin representación. El helper
no devuelve datos cacheados como respuesta a una recuperación. Preserva `_meta`,
errores, `retry_after`, máscara y resultado del servidor sin fabricar confirmación.

Si la primera petición lanzó error, devolvió incertidumbre o perdió su respuesta,
`recoverConfirmed` bloquea el reenvío. Usa `read` con una tool nativa de lectura y
los identificadores que ya conozcas para observar estado actual. Esa observación
no acredita la intención original. No hay una tool pública general para buscar
recibos por clave ni un modo público de «replay sólo si existe»: sin confirmación
original o contrato del dueño, queda pendiente. No cambies clave/CAS, no uses
otro actor/empresa/conexión y no programes retries para salir de incertidumbre.

La [receta y evidencia local](../../../docs/crm/continuity.md) describe los casos
comprobables. SSH-CRM-006/008 siguen pendientes de ejecución en un host real con
login/autorización del usuario; fixtures locales no los certifican.
