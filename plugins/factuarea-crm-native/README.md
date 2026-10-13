# Factuarea CRM Native

Paquete SOURCE `factuarea-crm-native` 0.2.0 para el recorrido comercial
lead→oportunidad→actividad, secuencias, administración de reservas y tiempo de
Task. Incluye cinco skills, 31 herramientas nativas documentadas y conexión al
servidor MCP existente. Cada operación exige discovery autenticado y permisos
actuales. El paquete no habilita capacidades ni implementa un servidor CRM.

## Carga local y actualización

Extrae el ZIP con su único directorio `factuarea-crm-native`, revisa manifiestos,
conexión y skills, y valida el paquete:

```sh
python3 factuarea-crm-native/scripts/validate_package.py
claude --plugin-dir ./factuarea-crm-native
```

La carga por directorio sigue la
[documentación oficial de Claude Code](https://code.claude.com/docs/en/plugins).
La carga anterior es una receta para el operador; no se ha ejecutado en esta
entrega. El catálogo de este repositorio registra la versión SOURCE 0.2.0.
Para instalar desde una copia revisada de ese catálogo local, el operador usa:

```text
/plugin marketplace add /ruta/a/la/copia-revisada-del-repositorio
/plugin install factuarea-crm-native@factuarea
```

La ruta debe señalar la raíz del repositorio que contiene
`.claude-plugin/marketplace.json` y `plugins/factuarea-crm-native`.
Confirma que el catálogo elegido es esa copia;
la publicación del catálogo upstream y la instalación efectiva siguen pendientes.
Para una actualización local, revisa la nueva versión/hashes, valida, reemplaza
el directorio por la versión revisada y reinicia la sesión. No ejecutes cargas
ni actualizaciones sin la autorización del operador. No habilites a la vez
otra declaración del mismo servidor `factuarea`; elige una conexión nativa y
conserva su origen para recuperar originales.

## Autenticación y entorno

La declaración HTTP real apunta a `https://mcp.factuarea.com` sin auth header.
En Claude Code, usa `/mcp`, el servidor factuarea y Authenticate para el flujo
OAuth del servidor. La Company y el entorno se eligen en el consentimiento
nativo; nunca en un parámetro fabricado por la skill. Una API key, cuando el
cliente/operación la requiere, se configura en el almacén privado del cliente,
fuera de este paquete. No copies tokens ni headers al repositorio o al ZIP.

Para la primera sesión usa sandbox seleccionado en el consentimiento o una
credencial de test emitida por Factuarea. Confirma ese contexto nativo antes de
operar; el plugin no convierte una credencial de producción en test. La política
del servidor puede limitar OAuth o denegar scopes/operaciones por plan, canal,
registro, campo o Company. No se asume administrador global.

Al revocar, usa los controles nativos de conexiones OAuth o API keys de la
cuenta Factuarea y desconecta el cliente; salir o quitar el plugin no sustituye
revocar una credencial. Después de revocar no llames herramientas ni recuperes
originales con una concesión histórica. Reautenticar requiere consentimiento
nuevo y revisión de Company/entorno/scopes.

## Scopes mínimos y uso

- Recorrido comercial: `crm_leads:read`, `crm_leads:write`,
  `crm_pipelines:read`, `crm_opportunities:read`, `crm_opportunities:write`,
  `crm_activities:read`, `crm_activities:write`, según cada herramienta.
- Secuencias: `automation:read` para list/preview; `automation:write` para
  mutations, controls y las dos Queries originales.
- Reservas staff: `booking:read` para list/get; `booking:write` para save y
  su Query original. Publicación necesita además una confirmación nativa real.
- Tiempo Task: `tasks:read`, `tasks:write` según operación; `tasks:delete`
  únicamente para borrado irreversible autorizado con API key.

Empieza con `/factuarea-crm-native:crm-native` y sigue la skill específica.
Para lead→oportunidad→actividad usa
`/factuarea-crm-native:crm-commercial-journey` y su
[receta de instalación y discovery](examples/journey.md#recorrido-literal-instalar-descubrir-lead-oportunidad-actividad).
Descubre primero tools y su inputSchema actuales en la conexión autenticada.
El inventario Source `plugin-contract.json` no concede permiso ni disponibilidad.
Si falta algo, informa unavailable; no simules una selección, resultado vacío,
UUID, recibo o servidor espejo. Los datos y ejemplos se citan por herramienta,
ID público y versión actual; no se recuperan campos ocultos por otra ruta.

Guarda el cuerpo exacto y una sola clave de la intención revisada. Cada mutación
se llama una vez tras confirmación humana y revalidación del contexto actual.
Ante ambigüedad utiliza únicamente su Query original disponible; no reenvíes.
Un head o preview actual no prueba el original. Los controles void y Task-time
no reciben un recibo original inventado. No se envían mensajes ni se derivan
permisos, cuentas o contactos del email. Ver [recetas](examples/journey.md).

El recorrido comercial utiliza `create_lead`/`find_lead`,
`list_pipelines`/`get_pipeline`, `create_opportunity`/`get_opportunity` y
`create_crm_activity`/`get_crm_activity`/`list_crm_activities`. Conserva los
UUIDs públicos devueltos y relaciona explícitamente `lead_id`, pipeline/etapa y
el target de la actividad. Esos nombres son MCP nativos; no usa aliases WebMCP.
Ante 409 o unconfirmed conserva clave, argumentos y cualquier ID factual;
detiene el paso siguiente. Estas tres creaciones no tienen Query original MCP
dedicada: una lectura actual informa estado y no acredita el recibo original.

## Evidencia actual y pendiente

Source: manifiestos y entrada de catálogo local sincronizados en 0.2.0,
endpoint nativo existente, 31 herramientas con hashes, cinco skills, esquema
y validador local. La receta comercial conserva sus nueve herramientas y
contratos nativos fijados en
[source-contract.json](skills/crm-commercial-journey/references/source-contract.json).
Hay un harness
preparado para herramientas/scopes/tenant/proveedor reales; no usa mocks como
prueba del servidor y no se ejecuta con esta entrega.

Pendiente: instalación, OAuth real, tools/list y llamadas reales, versión del
servidor desplegado, SSH-CRM-006/008, pruebas de tenant A/B y proveedor caído,
ejecución del journey lead→oportunidad→actividad, publicación del catálogo
upstream y release/activación del CRM completo.
Esta entrega no habilita producción, providers, SQL ni flags. No acredita
CRM-085 íntegro ni CRM-144 por inventario o por pruebas sólo de metadata.
`ratified=false` y las capabilities OFF del SOURCE del servidor se conservan;
el registro en el catálogo local no modifica esos gates ni otorga scopes.

El harness requiere un fixture privado validado y credenciales reales en env,
con sandbox y recursos seleccionados por sus propietarios. El comando de
operador (no ejecutado) es:

```sh
FACTUAREA_CRM_LIVE=1 FACTUAREA_CRM_FIXTURE=/ruta/privada/fixture.json \
  node --test factuarea-crm-native/tests/discovery-contract.test.mjs
```

Los fixtures no se incluyen con datos ficticios: consulta su schema y crea el
fixture únicamente con IDs, schemas y grants reales. El harness no ejecuta
mutaciones con credencial write; comprueba sólo llamadas de lectura y denegación
preflight de una escritura con credencial read. Toda escritura autorizada real
necesita otra receta revisada y no se deduce de esos resultados.

El preflight puro `tests/discovery-fixture.mjs` valida todo el fixture antes de
leer credenciales o abrir conexiones. Rechaza argumentos ajenos al contrato,
selección de autoridad por el caller, identidades incongruentes y sondas de
proveedor que mutan. Los tres tokens deben existir y ser distintos antes del
primer `initialize`. `tests/discovery-fixture.test.mjs` prepara negativos offline
con sentinels de forma; no aporta recursos ni autorización para una ejecución
real. Estos nuevos casos están escritos y pendientes de ejecución.

## Procedencia y licencia

El paquete sigue los manifiestos/skills del repositorio Factuarea, MIT. Las
instrucciones se redactaron para contratos nativos actuales; no copian ni
traducen código BottleCRM. Su referencia arquitectónica declarada y sus límites
se registran en [procedencia](crm/source-provenance.json). La clasificación y
revalidación upstream completas permanecen pendientes del change original.
