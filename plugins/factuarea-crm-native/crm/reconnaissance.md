# Reconocimiento del propietario real

El paquete vive en `plugins/factuarea-crm-native`, dentro del repositorio real
`factuarea-claude-plugins`. El checkout de referencia estaba limpio, con HEAD
separado en `5aa26f14df729dbd8fac7e8017c1f94ed6f1b3d2`. Se creó el worktree
`factuarea-claude-plugins-native-crm69`, rama `feature/crm-native-consumer-batch69`.
El checkout de referencia y los dos paquetes anteriores se conservan.

Se leyeron los AGENTS y REMOTE-SETUP del workspace. El repositorio de plugins
no contiene AGENTS ni CLAUDE propios. Se siguió el formato existente de
`.claude-plugin/plugin.json`, `.mcp.json`, `skills/<name>/SKILL.md` y su validador
Python. El validador anterior enumera sólo sus dos paquetes y seis skills;
este paquete tiene un validador propio, sin modificar ese registro compartido.
También incluye el manifiesto portable Agent Plugins 1.0 y `mcp.json`.

El servidor procede de la declaración real de `factuarea-mcp`: HTTP remoto en
`https://mcp.factuarea.com`, OAuth o credencial actual gestionada por el cliente.
No se añade servidor local, proxy, autenticación ni selección de empresa.
Claude Code no está instalado en este entorno. La carga desde directorio está
documentada por el proveedor; no se ha ejecutado una instalación.

La compatibilidad se fija por hashes de 31 herramientas Source actuales y sus
scopes en `plugin-contract.json`, no por una versión de servidor inventada.
El servidor conectado debe descubrir cada herramienta y su esquema vigente.
Este paquete no activa capacidades, providers, manifiestos ni producción.
El MCP no es WebMCP y una herramienta Source no prueba su descubribilidad.

Las instrucciones se adaptan a Company, permisos por registro y campo,
sandbox, Task y recibos originales de Factuarea. BottleCRM sólo es referencia
arquitectónica declarada por el change: no se copia código, SQL, perfiles ADMIN
ni selección Org. La revalidación del snapshot upstream y los gates reales
SSH-CRM-006/008 quedan pendientes; no se presentan como ejecutados.
