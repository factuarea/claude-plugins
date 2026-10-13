# Recetas nativas con datos actuales

Estas recetas se ejecutan sólo por un operador autorizado en sandbox. Los
nombres en mayúscula de abajo representan valores extraídos de respuestas
nativas y revisión humana; no son IDs ni cuerpos para copiar literalmente.
No se suministran UUIDs, claves, contactos o autorizaciones ficticias.

## Secuencia y recuperación original

1. Confirma la Company y sandbox del consentimiento/credencial actual. Descubre
   `list_crm_sequences` y `preview_crm_sequence`; consulta el recurso schedules
   mediante `filters` JSON string con resource explícito y limit real.
2. Toma SEQUENCE_ID y su versión de la respuesta visible. El sujeto proviene
   de una selección nativa real del usuario y una lectura autorizada; email
   no es identidad ni autorización de contacto. Consulta preview con ese
   ID original/tipo y start_at ISO con offset. Cita tools, IDs y versiones.
3. Para enrol, conserva ORIGINAL_WIRE exacto con subject_type, subject_id y
   expected_definition_version actuales. Prepara una única ORIGINAL_KEY
   opaca, sin trim (hasta 512 bytes). Revisa la intención y obtén confirmación
   humana. Si no existe tool/descriptor/proof actual, detente unavailable.
4. Llama `enrol_crm_sequence` una sola vez; el server asigna firstwinner IDs.
   Ante respuesta ambigua llama `get_crm_enrolment_original` sólo con
   ORIGINAL_KEY, desde el mismo origen y permiso automation:write actual.
   No reenroles, no cambies clave ni tomes preview/list como recibo.
5. Si aparece 409, lee el estado actual separado y presenta diferencias.
   Sólo otra intención humana revisada puede continuar; una revocación o
   original ausente mantiene la incertidumbre y no produce retry.

## Servicio de reservas staff

1. Descubre `list_booking_services`, `get_booking_service` y `list_bookings`.
   Selecciona SERVICE_ID de una respuesta autorizada. Lee el head actual para
   su CAS, sin derivarlo de un recibo anterior.
2. Prepara ORIGINAL_WIRE_BODY con definition y expected_version actuales.
   Usa host/resource y fuentes aprobados realmente, sin defaults de horarios.
   Si la publicación exige publication_confirmation_id, sólo el propietario
   nativo puede emitirlo para esa intención; confirmed no lo sustituye.
3. Revisa el patch, schedule IANA/DST y consecuencias. Confirma humanamente y
   llama `save_booking_service` una vez con id, clave exacta, cuerpo exacto y
   confirmed true. Crear omite id y el server asigna la primera identidad.
4. Ante unconfirmed, usa sólo `recover_booking_service_receipt` con el mismo
   id original si existía, clave y bytes originales. Null no demuestra que
   no ocurrió. Una lectura current sirve para revisar 409, nunca como recibo.
   Fuente de disponibilidad caída responde unavailable, no horario libre.

## Temporizador canónico Task

1. Confirma contexto y descubre las herramientas Task. Elige TASK_ID de Task
   actual autorizado. Consulta `get_running_task_timer` sin inventar argumentos.
2. Revisa el inicio y llama `start_task_timer` sólo con task_id tras confirmación
   humana. Si ya existe timer, conserva el primero y consúltalo; no lo reemplaces.
3. Confirma terminar el timer actual y llama `stop_task_timer`; cita id,
   ended_at y duration_seconds retornados. Ante respuesta ambigua informa
   estado desconocido y consulta timer/entrada conocida separadamente.
   No reinicies ni repitas stop como comprobación del original.
4. Para imputación cerrada revisa timestamps/offset/duración/billable antes de
   `create_task_time_entry`. Una entrada facturada se conserva ante error;
   no elimines una factura. Para borrar exige confirmación irreversible y
   canal/scope tasks:delete actuales; la clave es la que exige el schema nativo.

## Recorrido literal instalar-descubrir-lead-oportunidad-actividad

Esta receta completa el documento Source de la tarea 2.4. Instalación, OAuth,
discovery y ejecución no han ocurrido aquí; no se atribuyen al documento.
Todos los símbolos y campos proceden de las herramientas Source actuales y
están fijados en skills/crm-commercial-journey/references/source-contract.json.

1. **Instalar/cargar y autenticar.** Extrae el ZIP privado y valida con
   `python3 factuarea-crm-native/scripts/validate_package.py`. El operador
   autorizado carga `claude --plugin-dir ./factuarea-crm-native`; luego usa
   `/mcp` para Authenticate del servidor factuarea en su endpoint existente
   `https://mcp.factuarea.com`. Selecciona Company y sandbox en el consentimiento
   nativo; no cambies body para seleccionar tenant. La declaración no incorpora
   secretos. No mantengas simultáneamente otra declaración del mismo origen
   como sustitución de autoridad. No se ha ejecutado esta carga ni OAuth.
2. **Descubrir y cualificar antes de efectos.** Usa tools/list autenticado del
   cliente y consulta inputSchema de create_lead/find_lead, list_pipelines/
   get_pipeline, create_opportunity/get_opportunity y create_crm_activity/
   get_crm_activity/list_crm_activities. Exige sus scopes exactos
   crm_leads:read/write, crm_pipelines:read, crm_opportunities:read/write y
   crm_activities:read/write según el paso, bajo masks/registro actuales.
   Cualquier ausencia o incompatibilidad queda unavailable, nunca catálogo
   simulado. No llames create_crm_lead/get_crm_lead como aliases: esos nombres
   WebMCP no son los Name actuales de create_lead/find_lead.
3. **Crear el lead revisado.** Prepara los datos declarados reales (por ejemplo
   name y notes), source manual sólo si se envía, y una única LEAD_KEY opaca
   dentro del schema nativo. No suministres id/actor/role/tenant. Presenta la
   revisión al humano; tras confirmación y contexto actual llama create_lead
   una vez. Toma LEAD_ID exclusivamente de data.id nativo. Si se devuelve
   confirmed true/representation_available false, sólo la identidad está
   confirmada; no reconstruyas datos ocultos. Lee find_lead con id LEAD_ID
   y cita el id/version actual autorizado. No conviertas por email.
4. **Elegir pipeline/etapa actual.** Consulta list_pipelines y get_pipeline
   con el PIPELINE_ID seleccionado de resultados reales. Dentro de sus
   stages toma STAGE_ID activo, definition_version/revision y requisitos
   visibles. No adivines pertenencia de una etapa, campos requeridos o default.
   Si el catálogo/requisitos actual no admite completar el contrato cerrado,
   pide al usuario el flujo nativo correspondiente y detén la creación.
5. **Crear la oportunidad ligada al lead.** Prepara title explícito,
   lead_id LEAD_ID, pipeline_id PIPELINE_ID, stage_id STAGE_ID, amount string
   decimal y currency ISO de la intención real. contact_id queda omitido en
   este recorrido; no crees uno automáticamente. owner_id/team_id sólo si el
   usuario eligió opciones nativas autorizadas. Conserva OPPORTUNITY_KEY y
   argumentos originales; revisa/obtén confirmación humana. Llama
   create_opportunity una vez. Toma OPPORTUNITY_ID de data.id confirmado y
   consulta get_opportunity con ese id para su representación actual.
   Sólo muestra lead_id/pipeline_id/stage_id si el recurso los entrega bajo
   masks. Si el vínculo necesario queda oculto o la respuesta es incierta,
   no lo reconstruyas del request ni avances automáticamente.
6. **Registrar actividad explícita.** Presenta una nota real elegida por el
   usuario: type note, title, target objeto {type opportunity, id OPPORTUNITY_ID},
   timezone IANA explícita y body si fue aportado. Conserva ACTIVITY_KEY; no
   añadas id, effect_id, company_id, confirmed ni original_wire. Revisa y
   confirma humanamente antes de llamar create_crm_activity una sola vez.
   El resultado usa data.state, data.activity_id y data.effect_id. Sólo state
   confirmed acredita la creación; toma ACTIVITY_ID factual y consulta
   get_crm_activity con id ACTIVITY_ID para estado visible. list_crm_activities
   aporta listado actual con filtros/cursor del schema, no un recibo histórico.
   No crees una segunda Task; type task, si se eligiera en otra intención,
   ya utiliza el puente canónico. La nota no envía mensajes ni agenda reservas.
7. **409 y recuperación incierta.** Conserva el paso, clave, argumentos y
   UUID de servidor si llegó. En 409 con ID conocido, lee sólo el recurso
   actual por su herramienta; explica el conflicto y revisa con el humano
   una nueva intención separada. No cambies la clave del intento anterior,
   ni continúes los pasos siguientes usando una versión histórica. Ante
   timeout/pending/in_progress/unconfirmed, detente sin éxito afirmado. Con
   UUID conocido informa estado vía lectura actual; sin UUID, la identidad
   permanece desconocida. No hay Query original MCP dedicada para estas
   creaciones: documenta ese límite, no publiques un alias ni reenvíes create
   para recuperar. Un head, un listado o coincidencia por email/título no
   prueba el original. La revocación bloquea también las lecturas privadas.
8. **Cierre con evidencia.** Cita herramienta/ID/version y sólo campos
   autorizados de cada respuesta real. Si un paso es unavailable/uncertain,
   deja los posteriores sin ejecutar. El paquete y casos offline no prueban
   instalación/discovery, tenant A/B, proveedores ni SSH-CRM-006/008. Esos
   gates y producción continúan pendientes del checkpoint autorizado.
