# Conversión, concesiones y recuperación

Este bloque de Source amplía el [plugin CRM](README.md) en su repositorio canónico
y conserva el servidor `factuarea`, `.mcp.json`, OAuth y el skill anterior. El
[comando crm-continue](../../commands/crm-continue.md) descubre los pasos y carga
la [guía de continuidad](../../skills/factuarea-crm/references/continuity.md).
Su helper opcional consume callbacks de la conexión ya administrada por el host;
no es un servidor, un transporte ni una integración instalada automáticamente.

```js
import { createCrmJourney } from './plugins/factuarea-mcp/skills/factuarea-crm/scripts/crm-journey.mjs';

// existingFactuareaClient es la misma conexión autorizada por el host.
const crm = createCrmJourney({
  listTools: (params) => existingFactuareaClient.listTools(params),
  callTool: (params) => existingFactuareaClient.callTool(params),
});
const step = await crm.inspect(['preview_lead_conversion', 'convert_lead']);
// Si falta una tool, no ofrecer el paso; presencia no acredita los grants.
// IDs, intención y clave provienen de la selección y solicitud del usuario.
const review = await crm.reviewConversion({ id: selectedLeadId,
  strategy: 'link_existing', business_contact_id: selectedContactId,
  role_action: 'preserve' });
// Mostrar review.plan y obtener confirmación explícita de ese plan.
const prepared = await crm.prepareConversion(review, {
  confirmed: userConfirmedThisPlan, idempotencyKey: originalConversionKey,
});
const nativeResult = await crm.execute(prepared);
// Sólo después de observar un resultado nativo confirmado, y por solicitud:
const recoveredNativeResult = await crm.recoverConfirmed(prepared);
```

Para compartir un documento, `prepareDocumentGrant({id, grantType, granteeId,
expiresAt, idempotencyKey})` lee su versión actual. Para revocar,
`prepareDocumentRevocation({id, shareId, idempotencyKey})` exige un share nativo
visible y activo. El caller presenta el preview y confirma antes de `execute`.
Los scopes mínimos de estas tools son `crm_documents:read` y
`crm_documents:write`; el servidor aplica además permisos de registro, campos,
empresa, sandbox, conexión y políticas. No se transforman en grants locales.

El journey anterior Lead→Opportunity→Activity sigue siendo independiente de
la promoción fiscal. Una conversión nunca es requisito automático para crear
la oportunidad prefiscal. Documentos y tickets sólo se continúan si sus tools
nativas están visibles y su dueño/producer está disponible. Proposal canónico
ausente mantiene esa dependencia pendiente; Quote no lo sustituye.

La recuperación usa los contratos actuales de `FactuareaPublicMcpServer::runToolsCall`,
`ConfirmedIdentityReplay`, `ConvertLeadTool`, `LeadOperationResource`,
`CommercialDocumentTool`, `CommercialDocumentWriteTransport`,
`CommercialDocumentWriteReceiptResource`, `OpportunityDocumentsTool`,
`OpportunityDocumentsResource`, `ServiceTicketTool` y `ServiceTicketResource`.
Son dueños nativos de identidad/receipt/ACL; el plugin no copia sus ledgers.
No publica sus marcadores privados ni construye effect UUID/fingerprint.

La respuesta de concesión identifica el documento, no el share. El replay del
documento conserva su versión original. Lectura actual y recibo original se
consultan por separado. Los demás owners pueden devolver datos actuales con
máscara o el recibo de identidad sin representación. Nada local repone PII
retirada por el servidor. Ante resultado incierto, sólo se admite observación
de lectura; no existe aquí búsqueda de recibo por clave ni reenvío automático.

Prueba afectada de este bloque, ejecutada al cierre con Node 22:

```sh
node --test plugins/factuarea-mcp/tests/crm/crm-journey.test.mjs
```

Las pruebas son callbacks sintéticos de discovery/calls y verifican el helper,
los payloads y los límites locales. No prueban PHP, grants OAuth emitidos,
tenants reales, instalación de Claude ni CRM habilitado. Los 26 casos anteriores
conservan su evidencia verde y no se repiten por la edición YAML de CI.

La CI existente mantiene Python y añade Node 22 con la prueba anterior de 26.
La inclusión de esta nueva prueba en el mismo comando de CI se entrega como
propuesta separada. SSH-CRM-006 (CIMD/private_key_jwt/PKCE/login) y SSH-CRM-008
(host/journey prefiscal, aliases y aislamiento real) permanecen pendientes.
El paquete no se ha instalado, publicado ni activado por este bloque.
