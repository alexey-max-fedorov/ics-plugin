import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { CreateEventInput, DeleteEventInput, GetAvailabilityInput, GetCurrentDatetimeInput, GetEventsInput, ListCalendarsInput, SearchEventsInput, UpdateEventInput, toolDescriptions, toolJsonSchemas, } from './schemas.js';
import { callBridge } from './bridge.js';
function flag(name, value) {
    if (value === undefined || value === null)
        return [];
    return [`--${name}`, String(value)];
}
function bareFlag(name, on) {
    return on === true ? [`--${name}`] : [];
}
const handlers = {
    list_calendars: {
        name: 'list_calendars',
        description: toolDescriptions.list_calendars,
        inputSchema: toolJsonSchemas.list_calendars,
        zod: ListCalendarsInput,
        build: (a) => ['list-calendars', ...flag('type', a.type_filter ?? 'event')],
    },
    get_events: {
        name: 'get_events',
        description: toolDescriptions.get_events,
        inputSchema: toolJsonSchemas.get_events,
        zod: GetEventsInput,
        build: (a) => [
            'get-events',
            ...flag('start', a.start),
            ...flag('end', a.end),
            ...flag('calendar-id', a.calendar_id),
            ...bareFlag('no-all-day', a.include_all_day === false),
        ],
    },
    search_events: {
        name: 'search_events',
        description: toolDescriptions.search_events,
        inputSchema: toolJsonSchemas.search_events,
        zod: SearchEventsInput,
        build: (a) => [
            'search-events',
            ...flag('query', a.query),
            ...flag('start', a.start),
            ...flag('end', a.end),
            ...flag('calendar-id', a.calendar_id),
        ],
    },
    create_event: {
        name: 'create_event',
        description: toolDescriptions.create_event,
        inputSchema: toolJsonSchemas.create_event,
        zod: CreateEventInput,
        build: (a) => [
            'create-event',
            ...flag('title', a.title),
            ...flag('start', a.start),
            ...flag('end', a.end),
            ...bareFlag('all-day', a.all_day === true),
            ...flag('calendar-id', a.calendar_id),
            ...flag('location', a.location),
            ...flag('notes', a.notes),
            ...flag('url', a.url),
        ],
        timeoutMs: 15_000,
    },
    update_event: {
        name: 'update_event',
        description: toolDescriptions.update_event,
        inputSchema: toolJsonSchemas.update_event,
        zod: UpdateEventInput,
        build: (a) => [
            'update-event',
            ...flag('id', a.id),
            ...flag('title', a.title),
            ...flag('start', a.start),
            ...flag('end', a.end),
            ...flag('location', a.location),
            ...flag('notes', a.notes),
            ...flag('url', a.url),
            ...flag('calendar-id', a.calendar_id),
        ],
        timeoutMs: 15_000,
    },
    delete_event: {
        name: 'delete_event',
        description: toolDescriptions.delete_event,
        inputSchema: toolJsonSchemas.delete_event,
        zod: DeleteEventInput,
        build: (a) => [
            'delete-event',
            ...flag('id', a.id),
            ...flag('span', a.span ?? 'this_only'),
        ],
        timeoutMs: 15_000,
    },
    get_availability: {
        name: 'get_availability',
        description: toolDescriptions.get_availability,
        inputSchema: toolJsonSchemas.get_availability,
        zod: GetAvailabilityInput,
        build: (a) => [
            'get-availability',
            ...flag('start', a.start),
            ...flag('end', a.end),
            ...flag('calendar-ids', Array.isArray(a.calendar_ids) && a.calendar_ids.length > 0 ? a.calendar_ids.join(',') : undefined),
            ...flag('granularity', a.granularity_minutes ?? 30),
        ],
    },
    get_current_datetime: {
        name: 'get_current_datetime',
        description: toolDescriptions.get_current_datetime,
        inputSchema: toolJsonSchemas.get_current_datetime,
        zod: GetCurrentDatetimeInput,
        build: () => ['get-current-datetime'],
    },
};
function outcomeToMcp(outcome) {
    if (outcome.status === 'success') {
        return {
            content: [{ type: 'text', text: JSON.stringify(outcome.data) }],
        };
    }
    return {
        content: [{ type: 'text', text: outcome.error_message }],
        isError: true,
    };
}
async function main() {
    const server = new Server({ name: 'ical-integration', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: Object.values(handlers).map((h) => ({
            name: h.name,
            description: h.description,
            inputSchema: h.inputSchema,
        })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const name = req.params.name;
        const handler = handlers[name];
        if (!handler) {
            return {
                content: [{ type: 'text', text: `Unknown tool: ${String(req.params.name)}` }],
                isError: true,
            };
        }
        const parsed = handler.zod.safeParse(req.params.arguments ?? {});
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Invalid arguments for ${handler.name}: ${parsed.error.message}` }],
                isError: true,
            };
        }
        const args = handler.build(parsed.data);
        const outcome = await callBridge(args, { timeoutMs: handler.timeoutMs });
        return outcomeToMcp(outcome);
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    process.stderr.write(`ical-integration server crashed: ${err?.stack ?? err}\n`);
    process.exit(1);
});
