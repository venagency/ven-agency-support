const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_CF_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const aiTool = (name, description, parameters) => ({
	type: 'function',
	function: {
		name,
		description,
		parameters,
	},
});
const VEN_SUPPORT_TOOLS = [
	aiTool(
		'open_admin_screen',
		'Suggest opening a safe WordPress admin screen that can help the user complete the task.',
		{
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Relative WordPress admin path, such as edit.php?post_type=page or post.php?post=123&action=edit.',
				},
				label: {
					type: 'string',
					description: 'Short label for the action button.',
				},
				reason: {
					type: 'string',
					description: 'One sentence explaining why this screen helps.',
				},
			},
			required: ['path', 'label'],
		}
	),
	aiTool(
		'propose_page_change',
		'Draft a page or content change for the user to review before any WordPress content is changed.',
		{
			type: 'object',
			properties: {
				target: {
					type: 'string',
					description: 'The page, post, URL, block, field, or content area that should be changed.',
				},
				changeSummary: {
					type: 'string',
					description: 'A concise summary of the proposed change.',
				},
				proposedText: {
					type: 'string',
					description: 'The exact replacement or draft text when text is being changed.',
				},
				reason: {
					type: 'string',
					description: 'Why this change should be made.',
				},
			},
			required: ['target', 'changeSummary'],
		}
	),
	aiTool(
		'create_support_ticket',
		'Create a ClickUp support ticket for the Ven Agency team when the user needs implementation work, troubleshooting by a team member, or a fix that cannot be completed safely in chat.',
		{
			type: 'object',
			properties: {
				summary: {
					type: 'string',
					description: 'Short task title for Ven support.',
				},
				details: {
					type: 'string',
					description: 'Useful implementation notes for the support request.',
				},
				urgency: {
					type: 'string',
					enum: ['low', 'normal', 'high', 'urgent'],
				},
			},
			required: ['summary', 'details'],
		}
	),
];

export default {
	async fetch(request, env) {
		try {
			const url = new URL(request.url);
			if ('/health' === url.pathname && 'GET' === request.method) {
				return jsonResponse({ ok: true });
			}

			if ('POST' !== request.method) {
				return jsonResponse({ error: 'Not found' }, 404);
			}

			const rawBody = await readBoundedBody(request);
			const siteId = request.headers.get('x-ven-site-id') || '';
			const timestamp = request.headers.get('x-ven-timestamp') || '';
			const signature = request.headers.get('x-ven-signature') || '';
			const site = await verifySiteRequest(env, siteId, timestamp, signature, rawBody);
			const payload = parsePayload(rawBody, site);

			if ('/site-config' === url.pathname) {
				return jsonResponse({ ok: true, ...siteConfig(site) });
			}

			if ('/chat' === url.pathname) {
				const chat = await createAiReply(env, site, payload);
				return jsonResponse({ ok: true, ...chat });
			}

			if ('/support-task' === url.pathname) {
				const task = await createClickUpTask(env, site, payload);
				return jsonResponse({ ok: true, taskId: task.id, taskUrl: task.url || '' });
			}

			return jsonResponse({ error: 'Not found' }, 404);
		} catch (error) {
			const status = error.status || 500;
			console.error(JSON.stringify({ status, message: error.message }));
			return jsonResponse({ error: status >= 500 ? 'Ven support is unavailable.' : error.message }, status);
		}
	},
};

async function readBoundedBody(request) {
	const length = Number(request.headers.get('content-length') || 0);
	if (length > MAX_BODY_BYTES) {
		throw httpError('Support request is too large.', 413);
	}

	const body = await request.text();
	if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
		throw httpError('Support request is too large.', 413);
	}

	return body;
}

async function verifySiteRequest(env, siteId, timestamp, signature, rawBody) {
	if (!siteId || !timestamp || !signature) {
		throw httpError('Missing support gateway authorization headers.', 401);
	}

	const submittedAt = Number(timestamp);
	if (!Number.isFinite(submittedAt)) {
		throw httpError('Invalid support request timestamp.', 401);
	}

	const skewSeconds = Math.abs(Date.now() / 1000 - submittedAt);
	if (skewSeconds > MAX_CLOCK_SKEW_SECONDS) {
		throw httpError('Expired support request timestamp.', 401);
	}

	const site = authorizedSites(env)[siteId];
	if (!site || !site.secret) {
		throw httpError('Support site is not authorised.', 403);
	}

	const expected = await hmacHex(site.secret, `${timestamp}.${rawBody}`);
	if (!constantTimeEqual(signature.toLowerCase(), expected)) {
		throw httpError('Invalid support request signature.', 403);
	}

	return site;
}

function parsePayload(rawBody, site) {
	let payload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		throw httpError('Invalid support request payload.', 400);
	}

	const siteUrl = normalizeOrigin(payload.siteUrl || '');
	const allowedOrigins = (site.allowedOrigins || []).map(normalizeOrigin);
	if (!siteUrl || !allowedOrigins.includes(siteUrl)) {
		throw httpError('Support site origin is not authorised.', 403);
	}

	return payload;
}

function siteConfig(site) {
	const enabled = false !== site.enabled;
	return {
		enabled,
		chatEnabled: enabled && false !== site.chatEnabled,
		ticketsEnabled: enabled && false !== site.ticketsEnabled,
		title: site.title || 'Ven Support',
		intro: site.intro || 'Ask Ven for help with this website.',
		chatPlaceholder: site.chatPlaceholder || 'Ask about this website...',
	};
}

async function createAiReply(env, site, payload) {
	if (!site.enabled || !site.chatEnabled) {
		throw httpError('Ven chat is not enabled for this site.', 403);
	}

	const message = String(payload.message || '').trim();
	if (!message) {
		throw httpError('Chat message is required.', 400);
	}

	const history = Array.isArray(payload.history) ? payload.history.slice(-8) : [];
	const systemPrompt = [
		site.aiInstructions || 'You are Ven Agency website support. Help the logged-in website user troubleshoot WordPress content, forms, pages, and website issues. Keep replies concise. If the issue needs implementation work or a Ven team member should investigate, call create_support_ticket.',
		'You may use tools to suggest safe next actions. Never claim you have changed WordPress content directly. For page/content changes, propose the change for user review first. If the issue needs Ven implementation work or a team member to investigate, call create_support_ticket so the Worker can create a ClickUp task. Do not ask the user to switch to a separate support request form.',
		payload.context ? `Current WordPress context: ${JSON.stringify(safeContext(payload.context)).slice(0, 1200)}` : '',
	].filter(Boolean).join('\n\n');
	const messages = [
		{
			role: 'system',
			content: systemPrompt,
		},
		...history
			.filter((item) => item && ['user', 'assistant'].includes(item.role) && item.content)
			.map((item) => ({
				role: item.role,
				content: String(item.content).slice(0, 2000),
			})),
		{
			role: 'user',
			content: message.slice(0, 4000),
		},
	];

	if (env.AI) {
		const output = await env.AI.run(env.CF_AI_MODEL || site.aiModel || DEFAULT_CF_AI_MODEL, {
			messages,
			tools: VEN_SUPPORT_TOOLS,
			tool_choice: 'auto',
		});
		const reply = aiOutputText(output);
		const actions = await toolCallsToActions(toolCalls(output), payload, env, site);
		if (!reply && !actions.length) {
			console.error(JSON.stringify({ aiOutputWithoutReply: safeLogObject(output) }));
			throw httpError('Ven chat returned an empty response.', 502);
		}

		return {
			reply: reply || 'I have prepared a suggested next action for you.',
			actions,
		};
	}

	if (!env.OPENAI_API_KEY) {
		throw httpError('Ven chat is not configured.', 500);
	}

	const response = await fetch('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENAI_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model: site.aiModel || env.OPENAI_MODEL || 'gpt-5-mini',
			input: [
				{
					role: 'developer',
					content: [{ type: 'input_text', text: systemPrompt }],
				},
				...messages.slice(1).map((item) => ({
					role: item.role,
					content: [{ type: 'input_text', text: item.content }],
				})),
			],
			max_output_tokens: Number(site.maxOutputTokens || env.OPENAI_MAX_OUTPUT_TOKENS || 700),
		}),
	});

	const text = await response.text();
	if (!response.ok) {
		console.error(JSON.stringify({ openaiStatus: response.status, body: text.slice(0, 1000) }));
		throw httpError('Ven chat could not reply.', 502);
	}

	const body = JSON.parse(text);
	const reply = responseText(body);
	if (!reply) {
		throw httpError('Ven chat returned an empty response.', 502);
	}

	return { reply, actions: [] };
}

function toolCalls(output) {
	if (Array.isArray(output.tool_calls)) {
		return output.tool_calls;
	}

	if (Array.isArray(output.response?.tool_calls)) {
		return output.response.tool_calls;
	}

	if (Array.isArray(output.result?.tool_calls)) {
		return output.result.tool_calls;
	}

	const choiceCalls = output.choices?.[0]?.message?.tool_calls;
	return Array.isArray(choiceCalls) ? choiceCalls : [];
}

function aiOutputText(output) {
	if ('string' === typeof output) {
		return output.trim();
	}

	for (const value of [output.response, output.text, output.result, output.output_text]) {
		if ('string' === typeof value && value.trim()) {
			return value.trim();
		}
	}

	const choiceContent = output.choices?.[0]?.message?.content;
	if ('string' === typeof choiceContent && choiceContent.trim()) {
		return choiceContent.trim();
	}

	const responseContent = output.response?.content || output.result?.content;
	if ('string' === typeof responseContent && responseContent.trim()) {
		return responseContent.trim();
	}

	return '';
}

function safeLogObject(value) {
	try {
		return JSON.stringify(value).slice(0, 1000);
	} catch {
		return '[unserializable]';
	}
}

async function toolCallsToActions(calls, payload, env, site) {
	const actions = [];
	for (const call of calls.slice(0, 3)) {
		const action = await toolCallToAction(call, payload, env, site);
		if (action) {
			actions.push(action);
		}
	}

	return actions;
}

async function toolCallToAction(call, payload, env, site) {
	const name = call.name || call.function?.name || '';
	const args = parseToolArguments(call.arguments || call.function?.arguments || {});

	if ('open_admin_screen' === name) {
		const url = adminActionUrl(payload.adminUrl, args.path);
		if (!url) {
			return null;
		}

		return {
			type: 'open_admin_screen',
			label: String(args.label || 'Open admin screen').slice(0, 80),
			url,
			reason: String(args.reason || '').slice(0, 240),
		};
	}

	if ('propose_page_change' === name) {
		return {
			type: 'propose_page_change',
			label: 'Review proposed change',
			target: String(args.target || '').slice(0, 160),
			changeSummary: String(args.changeSummary || '').slice(0, 500),
			proposedText: String(args.proposedText || '').slice(0, 1500),
			reason: String(args.reason || '').slice(0, 300),
		};
	}

	if ('create_support_ticket' === name || 'prepare_support_request' === name) {
		const summary = String(args.summary || 'Website support request').slice(0, 120);
		const details = String(args.details || '').slice(0, 1500);
		const urgency = ['low', 'normal', 'high', 'urgent'].includes(args.urgency) ? args.urgency : 'normal';
		try {
			const task = await createClickUpTask(env, site, chatSupportTaskPayload(payload, { summary, details, urgency }));
			return {
				type: 'support_ticket_created',
				label: 'Ven support task created',
				message: 'I have created a ClickUp task for the Ven team. A team member will review it and reach out.',
				summary,
				urgency,
				taskId: task.id,
				taskUrl: task.url || '',
			};
		} catch (error) {
			return {
				type: 'support_ticket_failed',
				label: 'Support task could not be created',
				message: error.message || 'Ven support could not create a ClickUp task.',
				summary,
				details,
				urgency,
			};
		}
	}

	return null;
}

function parseToolArguments(value) {
	if (!value) {
		return {};
	}

	if ('string' === typeof value) {
		try {
			return JSON.parse(value);
		} catch {
			return {};
		}
	}

	return 'object' === typeof value ? value : {};
}

function adminActionUrl(adminUrl, path) {
	const base = String(adminUrl || '').trim();
	const requestedPath = String(path || '').trim();
	if (!base || !requestedPath || requestedPath.startsWith('http') || requestedPath.startsWith('//')) {
		return '';
	}

	const safePath = requestedPath.replace(/^\/+/, '');
	try {
		return new URL(safePath, base).toString();
	} catch {
		return '';
	}
}

function safeContext(context) {
	return {
		currentUrl: String(context.currentUrl || '').slice(0, 300),
		screenId: String(context.screenId || '').slice(0, 80),
		pageTitle: String(context.pageTitle || '').slice(0, 160),
		userLogin: String(context.userLogin || '').slice(0, 80),
		displayName: String(context.displayName || '').slice(0, 120),
		userEmail: String(context.userEmail || '').slice(0, 160),
		canManageOptions: Boolean(context.canManageOptions),
	};
}

function chatSupportTaskPayload(payload, ticket) {
	const context = payload.context || {};
	const details = [
		ticket.details,
		ticket.urgency ? `Urgency: ${ticket.urgency}` : '',
		context.currentUrl ? `Current admin screen: ${context.currentUrl}` : '',
	].filter(Boolean).join('\n\n');

	return {
		taskName: ticket.summary,
		name: String(context.displayName || context.userLogin || 'WordPress user').slice(0, 120),
		email: String(context.userEmail || '').slice(0, 160),
		phone: '',
		userLogin: String(context.userLogin || '').slice(0, 80),
		siteUrl: payload.siteUrl,
		adminUrl: payload.adminUrl,
		submittedFrom: context.currentUrl || payload.adminUrl || payload.siteUrl,
		message: details || ticket.summary,
		uploads: [],
		supportAccess: {
			requested: false,
			granted: false,
		},
	};
}

async function createClickUpTask(env, site, payload) {
	if (!site.enabled || !site.ticketsEnabled) {
		throw httpError('Ven support tasks are not enabled for this site.', 403);
	}

	if (!env.CLICKUP_TOKEN) {
		throw httpError('ClickUp is not configured.', 500);
	}

	if (!payload.taskName || !payload.message || !payload.name || !payload.email) {
		throw httpError('Support request is missing required fields.', 400);
	}

	if (!Array.isArray(payload.uploads)) {
		payload.uploads = [];
	}

	const listId = site.clickupListId || env.DEFAULT_CLICKUP_LIST_ID;
	if (!listId) {
		throw httpError('ClickUp List is not configured.', 500);
	}

	const response = await fetch(`${env.CLICKUP_API_BASE || 'https://api.clickup.com/api/v2'}/list/${encodeURIComponent(listId)}/task`, {
		method: 'POST',
		headers: {
			Authorization: env.CLICKUP_TOKEN,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			name: payload.taskName,
			markdown_content: supportMarkdown(payload),
			notify_all: false,
			tags: Array.from(new Set([...(site.tags || []), 'website-support'])),
		}),
	});

	const body = await response.text();
	if (!response.ok) {
		console.error(JSON.stringify({ clickupStatus: response.status, body: body.slice(0, 1000) }));
		throw httpError('ClickUp rejected the support task.', 502);
	}

	const task = JSON.parse(body);
	if (!task.id) {
		throw httpError('ClickUp returned an invalid task response.', 502);
	}

	return task;
}

function responseText(body) {
	if (typeof body.output_text === 'string') {
		return body.output_text;
	}

	const chunks = [];
	for (const item of body.output || []) {
		for (const content of item.content || []) {
			if ('output_text' === content.type && content.text) {
				chunks.push(content.text);
			}
		}
	}

	return chunks.join('\n').trim();
}

function supportMarkdown(payload) {
	const lines = [
		'## Website support request',
		'',
		`**Name:** ${payload.name}`,
		`**Email:** ${payload.email}`,
		`**Phone:** ${payload.phone || 'Not provided'}`,
		`**WordPress user:** ${payload.userLogin || 'Unknown'}`,
		`**Site:** ${payload.siteUrl}`,
		`**Submitted from:** ${payload.submittedFrom || payload.adminUrl || payload.siteUrl}`,
		'',
		'### Request',
		payload.message,
	];

	const uploads = payload.uploads.filter((upload) => upload && upload.url);
	if (uploads.length) {
		lines.push('', '### Uploaded files');
		for (const upload of uploads) {
			lines.push(`- [${upload.name || upload.url}](${upload.url})`);
		}
	}

	const supportAccess = payload.supportAccess || {};
	if (supportAccess.requested) {
		lines.push('', '### Temporary WordPress access');
		if (supportAccess.granted && supportAccess.accessUrl) {
			lines.push(
				`**Status:** Granted for ${supportAccess.duration || 'a limited time'}`,
				`**User:** ${supportAccess.userLogin || 'Ven support user'}`,
				`**Email:** ${supportAccess.email || 'dev@ven.com.au'}`,
				`**Expires:** ${supportAccess.expiresAt || 'Not provided'}`,
				`**Granted by:** ${supportAccess.grantedBy || payload.userLogin || 'Unknown'}`,
				'',
				`[Open temporary admin access](${supportAccess.accessUrl})`
			);
		} else {
			lines.push(`**Status:** Not granted${supportAccess.message ? ` - ${supportAccess.message}` : ''}`);
		}
	}

	return lines.join('\n');
}

function authorizedSites(env) {
	if (!env.AUTHORIZED_SITES) {
		throw httpError('No authorised support sites are configured.', 500);
	}

	try {
		return JSON.parse(env.AUTHORIZED_SITES);
	} catch {
		throw httpError('Authorised support sites are not valid JSON.', 500);
	}
}

async function hmacHex(secret, value) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
	return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
	if (left.length !== right.length) {
		return false;
	}

	let result = 0;
	for (let index = 0; index < left.length; index += 1) {
		result |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}

	return 0 === result;
}

function normalizeOrigin(value) {
	if (!value) {
		return '';
	}

	try {
		return new URL(value).origin.toLowerCase();
	} catch {
		return '';
	}
}

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
		},
	});
}

function httpError(message, status) {
	const error = new Error(message);
	error.status = status;
	return error;
}
