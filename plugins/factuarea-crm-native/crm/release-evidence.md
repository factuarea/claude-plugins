# Evidencia de release MCP/Plugin CRM — pendiente

Captura Source del 2026-10-13 para `crm-mcp-plugin-delivery` 3.1 (CRM-085).
No acredita carga del plugin, OAuth, discovery remoto, instalación o publicación.

| Identidad observada | Valor |
| --- | --- |
| Checkout | `repos/factuarea-claude-plugins-native-crm69` |
| Rama | `feature/crm-native-consumer-batch69` |
| HEAD local | `5aa26f14df729dbd8fac7e8017c1f94ed6f1b3d2` |
| Source propietario | `plugins/factuarea-crm-native/`, archivos sin seguimiento |
| Metadata declarada | `factuarea-crm-native` `0.2.0`, contrato `1` |
| SHA-256 `plugin-contract.json` | `e70ef03c196b79ed7c57697440e6be24ba91564834dd8cba2e1a14e52c3f8dfc` |
| SHA-256 `plugin.json` | `6e4e0b85fcfad478b288bd9b5aeb98690eaaa6b2759b2c5c3fefa521cd58c51a` |
| Catálogo declarado | 31 herramientas nativas / 14 scopes; no discovery observado |
| Servidor declarado | `https://mcp.factuarea.com`, Streamable HTTP; `live_server_version=null`, `live_discovery_verified=false` |

El HEAD no contiene el paquete CRM nuevo. La metadata 0.2.0 describe Source,
sin afirmar una versión instalada/publicada ni compatibilidad remota medida.
El plugin consume MCP y no lleva OpenAPI propio. El hash del catálogo anterior
no sustituye un hash OpenAPI de una release de API ni una revisión del host.
La evidencia de capacidad del change registra 21 pins iguales y diez distintos
frente al backend DEV-2 local; esa reconciliación permanece pendiente, sin
atribuir ninguna diferencia a producción.

El harness live de `tests/discovery-contract.test.mjs` conserva cuatro probes:
discovery read/write, lectura y denegación de write con read, tenant A/B y
proveedor no disponible. El preflight puro valida todo el fixture antes de
resolver tokens o inicializar clientes. Sus 18 casos offline están escritos en
`tests/discovery-fixture.test.mjs` y pendientes de ejecución; no prueban el
servidor ni proporcionan un fixture real. Los tokens sólo se resuelven del
entorno privado después de validar el fixture completo y se comprueban todos
antes de la primera conexión.

## Receta pendiente del operador

1. Conciliar los pins nativos y confirmar el Source en el repo propietario.
   Registrar commit/hashes de contrato, manifiestos, skills y archive. Los pins
   deben identificar bytes revisados; no basta el commit baseline de este doc.
2. En la fase de validación autorizada, ejecutar el validador local y los
   negativos offline. Empaquetar el único directorio incluyendo manifiestos
   ocultos y conservar hash/contenido del archive, sin secretos ni fixtures live.
3. Seguir la receta de README para cargar o instalar esa copia concreta en el
   host autorizado. Registrar host/versión, identidad del paquete realmente
   cargado, método y resultado. La receta documentada no es instalación.
4. Autenticar en el servidor existente y verificar Company/sandbox nativos.
   Conservar `initialize`/serverInfo/protocol y tools/list completo paginado,
   schemas y scopes actuales. Comprobar SSH-CRM-006/008 y las sondas live con
   fixture privado de recursos reales; no entregar tokens ni PII como evidencia.
5. Ejecutar el journey revisado y la revocación cuando estén autorizados. Las
   creaciones Lead/Opportunity/Activity sin Query original dedicada conservan
   incertidumbre; una lectura actual no se convierte en recibo original.
6. Publicar/actualizar el catálogo sólo con autorización de release. Conservar
   versión/revisión realmente distribuida y prueba externa de instalación;
   la entrada de marketplace local no demuestra esos pasos.

3.1 y la evidencia externa 2.7 siguen pendientes. No se ejecutaron suites,
probes MCP, instalación, publicación, push, PR ni activación. No se toca
runtime-evidence ni se afirma una versión instalada del servidor.
