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
		'Navigate to a safe WordPress admin screen. Prefer navigate_site for new navigation requests.',
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
		'navigate_site',
		'Navigate the user to a safe same-site WordPress admin or frontend screen when they ask to be taken somewhere.',
		{
			type: 'object',
			properties: {
				area: {
					type: 'string',
					enum: ['admin', 'site'],
					description: 'Use admin for wp-admin screens and site for frontend pages.',
				},
				path: {
					type: 'string',
					description: 'Relative same-site path. For admin, use paths like edit.php?post_type=page. For frontend, use paths like /contact/.',
				},
				label: {
					type: 'string',
					description: 'Short label for the navigation action.',
				},
				reason: {
					type: 'string',
					description: 'One sentence explaining where you are taking the user.',
				},
			},
			required: ['area', 'path', 'label'],
		}
	),
	aiTool(
		'annotate_screen',
		'Highlight an exact visible element, field, control, or row on the user screen and explain what to do next.',
		{
			type: 'object',
			properties: {
				selector: {
					type: 'string',
					description: 'Use a selector from the provided screen context. Prefer the element whose label or context best matches the setting or control the user asked about, such as [data-ven-screen-id="ven-screen-3"].',
				},
				label: {
					type: 'string',
					description: 'Short label shown near the highlighted field or control.',
				},
				instructions: {
					type: 'string',
					description: 'Concise instruction for what the user should do with this highlighted field or control. Mention if it is disabled or read-only.',
				},
				placement: {
					type: 'string',
					enum: ['top', 'right', 'bottom', 'left'],
				},
			},
			required: ['selector', 'label', 'instructions'],
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
		'update_post_data',
		'Prepare a confirmed WordPress post or page update for title, content, or excerpt when the user explicitly asks for an exact data change.',
		{
			type: 'object',
			properties: {
				postId: {
					type: 'integer',
					description: 'The WordPress post or page ID to update.',
				},
				postType: {
					type: 'string',
					description: 'The WordPress post type, such as page or post.',
				},
				summary: {
					type: 'string',
					description: 'Short summary of the update the user will confirm.',
				},
				fields: {
					type: 'object',
					properties: {
						title: {
							type: 'string',
							description: 'New post title.',
						},
						content: {
							type: 'string',
							description: 'New post content. Include the full replacement content.',
						},
						excerpt: {
							type: 'string',
							description: 'New post excerpt.',
						},
					},
				},
			},
			required: ['postId', 'summary', 'fields'],
		}
	),
	aiTool(
		'create_support_ticket',
		'Create a ClickUp support ticket for the Ven Agency team and ask a human to contact the WordPress user when the user wants support, asks for a human, or needs implementation work, troubleshooting by a team member, or a fix that cannot be completed safely in chat.',
		{
			type: 'object',
			properties: {
				summary: {
					type: 'string',
					description: 'Short task title for Ven support.',
				},
				details: {
					type: 'string',
					description: 'Useful implementation notes for the support request. Include what the user needs, what you observed, and why a Ven human should contact them.',
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

			if ('/widget.js' === url.pathname && 'GET' === request.method) {
				return javascriptResponse(widgetScript());
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
		'You may use tools to suggest safe next actions. When the user asks you to take them, move them, open a WordPress screen, or go to a frontend page, call navigate_site with a same-site relative path and do not merely suggest a link. When the user asks where something is, asks you to show or highlight a setting, or asks exactly where to change something on the current screen, call annotate_screen with the best matching visible field or control from screen.elements. Match by label, context, id, name, and visible text, and prefer a precise form field over a broad heading. If the user just arrived after navigation and asks you to continue the original request on the current screen, do not repeat the same navigation when the relevant control is now visible; annotate the control instead. For data updates, call update_post_data only for WordPress post/page title, content, or excerpt updates with exact new values; the user must confirm before WordPress applies the update. Never claim you have changed WordPress content directly unless a returned update action has been confirmed by WordPress. For page/content changes, propose the change for user review first. If the user asks for support, asks for a human, asks for Ven to contact them, or you determine the issue needs implementation work or team investigation, call create_support_ticket immediately so the Worker creates a ClickUp task for a human to contact the user. Do not ask the user to switch to a separate support request form.',
		payload.context ? `Current WordPress context: ${JSON.stringify(safeContext(payload.context)).slice(0, 4500)}` : '',
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

	if (explicitSupportIntent(message)) {
		const action = await createSupportTicketAction(env, site, payload, explicitSupportTicket(message, payload));
		return {
			reply: action.type === 'support_ticket_created'
				? 'I have created a ClickUp task for the Ven team. A team member will review it and contact you.'
				: action.message,
			actions: [action],
		};
	}

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
		const url = adminActionUrl(payload.siteUrl, payload.adminUrl, args.path);
		if (!url) {
			return null;
		}

		return {
			type: 'navigate_site',
			label: String(args.label || 'Open admin screen').slice(0, 80),
			url,
			area: 'admin',
			reason: String(args.reason || '').slice(0, 240),
		};
	}

	if ('navigate_site' === name) {
		const area = 'site' === args.area ? 'site' : 'admin';
		const url = navigationActionUrl(payload.siteUrl, payload.adminUrl, area, args.path);
		if (!url) {
			return null;
		}

		return {
			type: 'navigate_site',
			label: String(args.label || 'Open screen').slice(0, 80),
			url,
			area,
			reason: String(args.reason || '').slice(0, 240),
		};
	}

	if ('annotate_screen' === name) {
		const selector = String(args.selector || '').slice(0, 160);
		if (!selector) {
			return null;
		}

		return {
			type: 'annotate_screen',
			label: String(args.label || 'Look here').slice(0, 80),
			selector,
			instructions: String(args.instructions || '').slice(0, 320),
			placement: ['top', 'right', 'bottom', 'left'].includes(args.placement) ? args.placement : 'bottom',
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

	if ('update_post_data' === name) {
		const fields = updatePostFields(args.fields || {});
		const postId = Number(args.postId);
		if (!Number.isInteger(postId) || postId < 1 || !Object.keys(fields).length) {
			return null;
		}

		return {
			type: 'update_post_data',
			label: 'Apply update',
			summary: String(args.summary || 'Update WordPress data').slice(0, 240),
			postId,
			postType: String(args.postType || '').slice(0, 40),
			fields,
		};
	}

	if ('create_support_ticket' === name || 'prepare_support_request' === name) {
		const summary = String(args.summary || 'Website support request').slice(0, 120);
		const details = String(args.details || payload.message || '').slice(0, 1500);
		const urgency = ['low', 'normal', 'high', 'urgent'].includes(args.urgency) ? args.urgency : 'normal';
		return createSupportTicketAction(env, site, payload, { summary, details, urgency });
	}

	return null;
}

function explicitSupportIntent(message) {
	const text = String(message || '').toLowerCase();
	if (!text) {
		return false;
	}

	return [
		/\b(create|open|raise|submit|send|log)\b.{0,24}\b(support|ticket|task|request)\b/,
		/\b(i|we)\s+(need|want)\b.{0,24}\b(support|help from (a )?(human|person|team)|a human|someone|ven)\b/,
		/\b(can|could|please)\b.{0,24}\b(someone|a human|a person|the team|ven)\b.{0,40}\b(contact|call|email|reach out|get back|look into|jump in|fix)\b/,
		/\b(human|person|team member|ven)\b.{0,24}\b(contact|call|email|reach out|jump in|look into|fix)\b/,
		/\b(escalate|hand this off|pass this to|send this to)\b.{0,30}\b(ven|support|the team|a human|someone)\b/,
	].some((pattern) => pattern.test(text));
}

function explicitSupportTicket(message, payload) {
	const summarySource = String(message || 'Website support request').replace(/\s+/g, ' ').trim();
	return {
		summary: `Website support: ${summarySource}`.slice(0, 120),
		details: [
			'The user explicitly asked for Ven support or human follow-up from the support chat.',
			`User request: ${summarySource}`,
		].filter(Boolean).join('\n\n').slice(0, 1500),
		urgency: 'normal',
	};
}

async function createSupportTicketAction(env, site, payload, ticket) {
	const summary = String(ticket.summary || 'Website support request').slice(0, 120);
	const details = String(ticket.details || payload.message || summary).slice(0, 1500);
	const urgency = ['low', 'normal', 'high', 'urgent'].includes(ticket.urgency) ? ticket.urgency : 'normal';
	try {
		const task = await createClickUpTask(env, site, chatSupportTaskPayload(payload, { summary, details, urgency }));
		return {
			type: 'support_ticket_created',
			label: 'Ven support task created',
			message: 'I have created a ClickUp task for the Ven team. A team member will review it and contact you.',
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

function updatePostFields(fields) {
	const clean = {};
	if (!fields || 'object' !== typeof fields) {
		return clean;
	}

	if ('string' === typeof fields.title) {
		clean.title = fields.title.slice(0, 250);
	}

	if ('string' === typeof fields.content) {
		clean.content = fields.content.slice(0, 12000);
	}

	if ('string' === typeof fields.excerpt) {
		clean.excerpt = fields.excerpt.slice(0, 1000);
	}

	return clean;
}

function adminActionUrl(siteUrl, adminUrl, path) {
	return navigationActionUrl(siteUrl, adminUrl, 'admin', path);
}

function navigationActionUrl(siteUrl, adminUrl, area, path) {
	const siteBase = String(siteUrl || '').trim();
	const adminBase = String(adminUrl || '').trim();
	const requestedPath = String(path || '').trim();
	const siteOrigin = normalizeOrigin(siteBase);
	if (!siteOrigin || !requestedPath || /^[a-z][a-z\d+.-]*:/i.test(requestedPath) || requestedPath.startsWith('//')) {
		return '';
	}

	try {
		if ('admin' === area) {
			const admin = new URL(adminBase || siteBase);
			const adminRootPath = admin.pathname.replace(/[^/]*$/, '');
			const adminRoot = `${admin.origin}${adminRootPath}`;
			const target = requestedPath.startsWith('/')
				? new URL(requestedPath, siteBase)
				: new URL(requestedPath.replace(/^wp-admin\//, ''), adminRoot);
			if (target.origin.toLowerCase() !== siteOrigin || !target.pathname.startsWith(adminRootPath)) {
				return '';
			}

			return target.toString();
		}

		const target = new URL(requestedPath, siteBase);
		if (target.origin.toLowerCase() !== siteOrigin) {
			return '';
		}

		return target.toString();
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
		screen: safeScreenContext(context.screen),
	};
}

function safeScreenContext(screen) {
	if (!screen || 'object' !== typeof screen) {
		return {};
	}

	const elements = Array.isArray(screen.elements) ? screen.elements.slice(0, 60).map((element) => ({
		selector: String(element.selector || '').slice(0, 120),
		tag: String(element.tag || '').slice(0, 20),
		role: String(element.role || '').slice(0, 40),
		label: String(element.label || '').slice(0, 180),
		text: String(element.text || '').slice(0, 180),
		context: String(element.context || '').slice(0, 260),
		href: String(element.href || '').slice(0, 260),
		id: String(element.id || '').slice(0, 80),
		name: String(element.name || '').slice(0, 80),
		type: String(element.type || '').slice(0, 40),
		disabled: Boolean(element.disabled),
		readOnly: Boolean(element.readOnly),
		rect: element.rect && 'object' === typeof element.rect ? {
			x: Number(element.rect.x) || 0,
			y: Number(element.rect.y) || 0,
			width: Number(element.rect.width) || 0,
			height: Number(element.rect.height) || 0,
		} : undefined,
	})) : [];

	return {
		url: String(screen.url || '').slice(0, 300),
		title: String(screen.title || '').slice(0, 180),
		viewport: screen.viewport && 'object' === typeof screen.viewport ? {
			width: Number(screen.viewport.width) || 0,
			height: Number(screen.viewport.height) || 0,
		} : undefined,
		elements,
	};
}

function chatSupportTaskPayload(payload, ticket) {
	const context = payload.context || {};
	const latestMessage = String(payload.message || '').trim();
	const conversation = conversationExcerpt(payload);
	const details = [
		'A Ven team member should contact the user using the contact details above.',
		ticket.details,
		latestMessage && !String(ticket.details || '').includes(latestMessage) ? `Latest user message: ${latestMessage}` : '',
		ticket.urgency ? `Urgency: ${ticket.urgency}` : '',
		context.currentUrl ? `Current admin screen: ${context.currentUrl}` : '',
		conversation ? `Recent chat context:\n${conversation}` : '',
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
		contactRequested: true,
		uploads: [],
		supportAccess: {
			requested: false,
			granted: false,
		},
	};
}

function conversationExcerpt(payload) {
	const history = Array.isArray(payload.history) ? payload.history.slice(-6) : [];
	const lines = history
		.filter((item) => item && ['user', 'assistant'].includes(item.role) && item.content)
		.map((item) => `${item.role}: ${String(item.content).replace(/\s+/g, ' ').trim().slice(0, 500)}`);
	const latest = String(payload.message || '').replace(/\s+/g, ' ').trim();
	if (latest && !lines.some((line) => line.endsWith(latest))) {
		lines.push(`user: ${latest.slice(0, 500)}`);
	}
	return lines.slice(-6).join('\n');
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
	];

	if (payload.contactRequested) {
		lines.push(
			'',
			'### Requested follow-up',
			'A Ven team member should contact this user using the email address above.'
		);
	}

	lines.push('', '### Request', payload.message);

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

function javascriptResponse(source) {
	return new Response(source, {
		headers: {
			'Content-Type': 'application/javascript; charset=utf-8',
			'Cache-Control': 'public, max-age=300',
			'Access-Control-Allow-Origin': '*',
		},
	});
}

function httpError(message, status) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function widgetScript() {
	return String.raw`(function () {
	function bootVenSupportWidget() {
	var config = window.VenSupportConnector || {};
	if (!config || !config.restUrl || !config.nonce || document.getElementById('ven-support-widget')) return;
	var settings = config.settings || {};
	if (!settings.enabled || !settings.chatEnabled) return;

	var host = document.createElement('div');
	host.id = 'ven-support-widget';
	document.body.appendChild(host);
	var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
	var style = document.createElement('style');
	style.textContent = [
		':host{all:initial}',
		'.ven-support-assistant{--ven-radius:24px;bottom:24px;color:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;position:fixed;right:24px;z-index:100000}',
		'.ven-support-assistant *{box-sizing:border-box}',
		'.ven-support-assistant__launcher{align-items:center;background:#111214;border:1px solid rgba(255,255,255,.14);border-radius:var(--ven-radius);box-shadow:0 16px 44px rgba(0,0,0,.26);color:#fff;cursor:pointer;display:flex;font-size:18px;font-weight:700;height:38px;justify-content:center;letter-spacing:0;padding:0;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease;width:38px}',
		'.ven-support-assistant__launcher:hover,.ven-support-assistant__launcher:focus{border-color:rgba(255,255,255,.32);box-shadow:0 20px 54px rgba(0,0,0,.34);outline:none;transform:translateY(-1px)}',
		'.ven-support-assistant__window{background:linear-gradient(180deg,#171719 0%,#0d0e10 100%);border:1px solid rgba(255,255,255,.12);border-radius:var(--ven-radius);bottom:56px;box-shadow:0 24px 80px rgba(0,0,0,.32);max-height:calc(100vh - 96px);overflow:auto;padding:22px;position:absolute;right:0;width:min(378px,calc(100vw - 48px))}',
		'.ven-support-assistant__window[hidden]{display:none!important}',
		'.ven-support-assistant__head{align-items:center;display:flex;gap:16px;justify-content:space-between;margin-bottom:18px}',
		'.ven-support-assistant__logo{color:#fff;font-size:30px;font-weight:800;letter-spacing:0;line-height:1}',
		'.ven-support-assistant__close{align-items:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);border-radius:var(--ven-radius);color:rgba(255,255,255,.78);cursor:pointer;display:flex;font-size:20px;height:32px;justify-content:center;line-height:1;padding:0;width:32px}',
		'.ven-support-assistant__hero{margin:0 0 20px}',
		'.ven-support-assistant__hero h2{color:#fff;font-size:27px;font-weight:520;letter-spacing:0;line-height:1.08;margin:0 0 9px}',
		'.ven-support-assistant__hero span{color:rgba(255,255,255,.56);display:block;font-size:13px;line-height:1.45}',
		'.ven-support-assistant__panel{display:grid;gap:16px;grid-template-rows:minmax(190px,1fr) auto;min-height:min(430px,calc(100vh - 190px))}',
		'.ven-support-assistant__messages{background:transparent;border:0;display:flex;flex-direction:column;gap:10px;justify-content:flex-end;margin:0;min-height:0;overflow:auto;padding:0}',
		'.ven-support-assistant__messages.has-overflow{-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 30px,#000 100%);justify-content:flex-start;mask-image:linear-gradient(to bottom,transparent 0,#000 30px,#000 100%)}',
		'.ven-support-assistant__message{border-radius:var(--ven-radius);font-size:13px;line-height:1.45;padding:10px 14px;white-space:pre-wrap}',
		'.ven-support-assistant__message--user{align-self:flex-end;background:#fff;color:#111214;max-width:86%}',
		'.ven-support-assistant__message--assistant{align-self:flex-start;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.88);max-width:92%}',
		'.ven-support-assistant__action{align-self:stretch;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:var(--ven-radius);color:rgba(255,255,255,.68);font-size:13px;line-height:1.45;padding:11px 12px}',
		'.ven-support-assistant__action strong{color:#fff;display:block;margin-bottom:4px}',
		'.ven-support-assistant__action p{margin:0 0 8px}',
		'.ven-support-assistant__action pre{background:rgba(0,0,0,.22);border-radius:var(--ven-radius);color:#fff;margin:8px 0;max-height:150px;overflow:auto;padding:8px;white-space:pre-wrap}',
		'.ven-support-assistant__action button,.ven-support-assistant__action a{align-items:center;background:#fff;border:0;border-radius:var(--ven-radius);color:#111214;cursor:pointer;display:inline-flex;font-weight:700;min-height:30px;padding:5px 12px;text-decoration:none}',
		'.ven-support-assistant__action button[disabled]{cursor:wait;opacity:.64}',
		'.ven-support-assistant__chat-form{align-items:flex-end;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:var(--ven-radius);box-shadow:inset 0 1px 0 rgba(255,255,255,.04);display:flex;gap:9px;padding:11px 11px 11px 16px}',
		'.ven-support-assistant__chat-form textarea{background:transparent;border:0;box-shadow:none;color:#f6f7f9;flex:1;font-family:inherit;font-size:14px;line-height:1.4;min-height:43px;outline:none;padding:9px 0;resize:none;width:100%}',
		'.ven-support-assistant__chat-form textarea::placeholder{color:rgba(255,255,255,.46)}',
		'.ven-support-assistant__chat-form button{align-items:center;background:#fff;border:0;border-radius:var(--ven-radius);color:#111214;cursor:pointer;display:inline-flex;flex:0 0 38px;font-size:20px;font-weight:500;height:38px;justify-content:center;line-height:1;min-height:38px;padding:0;width:38px}',
		'@media (max-width:782px){.ven-support-assistant{bottom:16px;right:16px}.ven-support-assistant__window{bottom:52px;max-height:calc(100vh - 84px);width:calc(100vw - 32px)}}'
	].join('\n');
	shadow.appendChild(style);

	var app = document.createElement('div');
	app.className = 'ven-support-assistant';
	app.setAttribute('data-ven-support-assistant', '');
	app.innerHTML = [
		'<button type="button" class="ven-support-assistant__launcher" data-ven-launcher aria-expanded="false" aria-label="Open Ven support">v</button>',
		'<div class="ven-support-assistant__window" data-ven-window hidden>',
		'<div class="ven-support-assistant__head"><div class="ven-support-assistant__logo">ven.</div><button type="button" class="ven-support-assistant__close" data-ven-close aria-label="Close Ven support">&times;</button></div>',
		'<div class="ven-support-assistant__hero"><h2>What can we help with?</h2><span data-ven-intro></span></div>',
		'<section class="ven-support-assistant__panel" data-ven-panel="chat"><div class="ven-support-assistant__messages" data-ven-messages aria-live="polite"></div><form class="ven-support-assistant__chat-form" data-ven-chat-form><textarea name="message" rows="3" required></textarea><button type="submit" aria-label="Send">-&gt;</button></form></section>',
		'</div>'
	].join('');
	shadow.appendChild(app);

	var root = app;
	var launcher = root.querySelector('[data-ven-launcher]');
	var close = root.querySelector('[data-ven-close]');
	var win = root.querySelector('[data-ven-window]');
	var messages = root.querySelector('[data-ven-messages]');
	var input = root.querySelector('textarea[name="message"]');
	var intro = root.querySelector('[data-ven-intro]');
	var history = [];
	var chatMessages = [];
	var pendingNavigation = null;
	var stateKey = config.stateKey || 'venSupportAssistantState:v3';
	var legacyStateKey = 'venSupportAssistantState:v2';
	var stateTtl = 14 * 24 * 60 * 60 * 1000;

	if (intro) intro.textContent = settings.intro || 'Ask Ven for help with this website.';
	if (input) input.setAttribute('placeholder', settings.chatPlaceholder || 'Ask about this website...');

	var annotationStyle = document.getElementById('ven-support-annotation-style');
	if (!annotationStyle) {
		annotationStyle = document.createElement('style');
		annotationStyle.id = 'ven-support-annotation-style';
		annotationStyle.textContent = [
			'.ven-support-screen-highlight{border:2px solid #1e8cff;border-radius:10px;box-shadow:0 0 0 9999px rgba(8,13,20,.22),0 0 0 5px rgba(30,140,255,.18);box-sizing:border-box;pointer-events:none;position:fixed;z-index:100001}',
			'.ven-support-screen-callout{background:#111214;border:1px solid rgba(255,255,255,.18);border-radius:14px;box-shadow:0 18px 45px rgba(0,0,0,.28);box-sizing:border-box;color:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:min(320px,calc(100vw - 32px));padding:12px 14px;position:fixed;z-index:100002}',
			'.ven-support-screen-callout strong{display:block;font-size:13px;margin:0 24px 4px 0}',
			'.ven-support-screen-callout p{color:rgba(255,255,255,.72);font-size:13px;line-height:1.42;margin:0}',
			'.ven-support-screen-callout button{align-items:center;background:rgba(255,255,255,.1);border:0;border-radius:999px;color:rgba(255,255,255,.8);cursor:pointer;display:flex;height:22px;justify-content:center;padding:0;position:absolute;right:8px;top:8px;width:22px}'
		].join('\n');
		document.head.appendChild(annotationStyle);
	}

	function getStorage(type) {
		try {
			var storage = window[type];
			var testKey = stateKey + ':test';
			storage.setItem(testKey, '1');
			storage.removeItem(testKey);
			return storage;
		} catch (error) {
			return null;
		}
	}
	var persistentStorage = getStorage('localStorage') || getStorage('sessionStorage');
	var sessionStorageFallback = getStorage('sessionStorage');
	function storageGet(storage, key) {
		try { return storage ? storage.getItem(key) : ''; } catch (error) { return ''; }
	}
	function storageSet(storage, key, value) {
		try { if (storage) storage.setItem(key, value); } catch (error) {}
	}
	function storageRemove(storage, key) {
		try { if (storage) storage.removeItem(key); } catch (error) {}
	}
	function parseStoredState(value) {
		try { return value ? JSON.parse(value) : {}; } catch (error) { return {}; }
	}
	function readAssistantState() {
		var state = parseStoredState(storageGet(persistentStorage, stateKey));
		if ((!state || !state.updatedAt) && sessionStorageFallback) {
			state = parseStoredState(storageGet(sessionStorageFallback, legacyStateKey));
			if (state && state.updatedAt) {
				storageSet(persistentStorage, stateKey, JSON.stringify(Object.assign({}, state, { migratedAt: Date.now() })));
				storageRemove(sessionStorageFallback, legacyStateKey);
			}
		}
		if (!state || !state.updatedAt) return {};
		if (Date.now() - state.updatedAt > stateTtl) {
			storageRemove(persistentStorage, stateKey);
			storageRemove(sessionStorageFallback, legacyStateKey);
			return {};
		}
		return state;
	}
	function saveAssistantState(extra) {
		var state = Object.assign({
			open: win ? !win.hidden : false,
			messages: chatMessages.slice(-50),
			history: history.slice(-16),
			pendingNavigation: pendingNavigation,
			updatedAt: Date.now(),
			version: 3
		}, extra || {});
		storageSet(persistentStorage, stateKey, JSON.stringify(state));
	}
	function toggle(open, options) {
		if (!win || !launcher) return;
		win.hidden = !open;
		launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
		if (!options || options.persist !== false) saveAssistantState({ open: open });
	}
	if (launcher) launcher.addEventListener('click', function () { toggle(!win || win.hidden); });
	if (close) close.addEventListener('click', function () { toggle(false); });
	function updateMessagesLayout() {
		if (!messages) return;
		var hasOverflow = messages.scrollHeight > messages.clientHeight + 1;
		messages.classList.toggle('has-overflow', hasOverflow);
		messages.scrollTop = messages.scrollHeight;
	}
	function safeNavigationUrl(url) {
		try {
			var target = new URL(url, window.location.href);
			return target.origin === window.location.origin ? target.toString() : '';
		} catch (error) {
			return '';
		}
	}
	function navigationTargetUrl(action) {
		if (!action || action.type !== 'navigate_site') return '';
		return safeNavigationUrl(action.url || '');
	}
	function sameNavigationUrl(left, right) {
		try {
			var a = new URL(left, window.location.href);
			var b = new URL(right, window.location.href);
			return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
		} catch (error) {
			return false;
		}
	}
	function readableText(element) {
		return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
	}
	function fieldLabel(element) {
		var direct = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder');
		if (direct) return direct;
		if (element.id && window.CSS && CSS.escape) {
			var label = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
			if (label && readableText(label)) return readableText(label);
		}
		var wrappingLabel = element.closest('label');
		if (wrappingLabel && readableText(wrappingLabel)) return readableText(wrappingLabel);
		var row = element.closest('tr');
		if (row) {
			var rowLabel = row.querySelector('th label, th, .label, .form-field label');
			if (rowLabel && readableText(rowLabel)) return readableText(rowLabel);
		}
		return element.getAttribute('name') || readableText(element);
	}
	function fieldContext(element) {
		var row = element.closest('tr,.form-field,.acf-field,.components-panel__row,.edit-post-post-link__preview-label');
		if (row && readableText(row)) return readableText(row).slice(0, 260);
		return '';
	}
	function screenContextWeight(element) {
		var weight = 0;
		if (element.closest('#wpbody-content,.edit-post-layout__content,.interface-interface-skeleton__content,main')) weight -= 1000;
		if (element.matches('input:not([type="hidden"]),textarea,select')) weight -= 120;
		if (element.matches('button,[role="button"],[role="tab"],[role="menuitem"]')) weight -= 40;
		if (element.matches('a[href]')) weight += 20;
		if (element.closest('#adminmenu,#wpadminbar')) weight += 450;
		return weight;
	}
	function isVisibleElement(element) {
		if (!element || element === host || host.contains(element) || element.closest('.ven-support-screen-highlight,.ven-support-screen-callout')) return false;
		if (element.matches('input[type="hidden"],input[type="password"],script,style')) return false;
		var rect = element.getBoundingClientRect();
		var computed = window.getComputedStyle(element);
		return rect.width > 0 && rect.height > 0 && computed.display !== 'none' && computed.visibility !== 'hidden' && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
	}
	function collectScreenContext() {
		var selectors = ['h1','h2','h3','.notice','[role="alert"]','a[href]','button','input:not([type="hidden"])','textarea','select','[role="button"]','[role="tab"]','[role="menuitem"]'].join(',');
		var elements = Array.prototype.slice.call(document.querySelectorAll(selectors)).filter(isVisibleElement).sort(function (a, b) {
			var weight = screenContextWeight(a) - screenContextWeight(b);
			if (weight) return weight;
			var aRect = a.getBoundingClientRect();
			var bRect = b.getBoundingClientRect();
			return aRect.top === bRect.top ? aRect.left - bRect.left : aRect.top - bRect.top;
		}).slice(0, 60).map(function (element, index) {
			var screenId = 'ven-screen-' + index;
			element.setAttribute('data-ven-screen-id', screenId);
			var rect = element.getBoundingClientRect();
			return {
				selector: '[data-ven-screen-id="' + screenId + '"]',
				tag: element.tagName.toLowerCase(),
				role: element.getAttribute('role') || '',
				label: String(fieldLabel(element) || '').replace(/\s+/g, ' ').trim().slice(0, 180),
				text: readableText(element),
				context: fieldContext(element),
				href: element.href || '',
				id: element.id || '',
				name: element.getAttribute('name') || '',
				type: element.getAttribute('type') || '',
				disabled: Boolean(element.disabled),
				readOnly: Boolean(element.readOnly),
				rect: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
			};
		});
		return { url: window.location.href, title: document.title || '', viewport: { width: window.innerWidth, height: window.innerHeight }, elements: elements };
	}
	function clearAnnotation() {
		document.querySelectorAll('.ven-support-screen-highlight,.ven-support-screen-callout').forEach(function (node) { node.remove(); });
	}
	function showAnnotation(action) {
		if (!action || !action.selector) return;
		var target = null;
		try { target = document.querySelector(action.selector); } catch (error) { return; }
		if (!target || host.contains(target)) return;
		clearAnnotation();
		target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
		window.setTimeout(function () {
			var rect = target.getBoundingClientRect();
			var highlight = document.createElement('div');
			highlight.className = 'ven-support-screen-highlight';
			highlight.style.left = Math.max(8, rect.left - 6) + 'px';
			highlight.style.top = Math.max(8, rect.top - 6) + 'px';
			highlight.style.width = Math.max(24, rect.width + 12) + 'px';
			highlight.style.height = Math.max(24, rect.height + 12) + 'px';
			var callout = document.createElement('div');
			callout.className = 'ven-support-screen-callout';
			var title = document.createElement('strong');
			title.textContent = action.label || 'Look here';
			var closeButton = document.createElement('button');
			closeButton.type = 'button';
			closeButton.textContent = 'x';
			closeButton.setAttribute('aria-label', 'Dismiss highlight');
			closeButton.addEventListener('click', clearAnnotation);
			var text = document.createElement('p');
			text.textContent = action.instructions || 'Use this item to continue.';
			callout.appendChild(title);
			callout.appendChild(closeButton);
			callout.appendChild(text);
			document.body.appendChild(highlight);
			document.body.appendChild(callout);
			var calloutRect = callout.getBoundingClientRect();
			var preferredLeft = Math.min(window.innerWidth - calloutRect.width - 16, Math.max(16, rect.left));
			var below = rect.bottom + 14;
			var above = rect.top - calloutRect.height - 14;
			callout.style.left = preferredLeft + 'px';
			callout.style.top = (below + calloutRect.height + 16 <= window.innerHeight ? below : Math.max(16, above)) + 'px';
		}, 280);
	}
	function renderMessage(role, text) {
		if (!messages || !text) return null;
		var node = document.createElement('div');
		node.className = 'ven-support-assistant__message ven-support-assistant__message--' + role;
		node.textContent = text;
		messages.appendChild(node);
		updateMessagesLayout();
		return node;
	}
	function addMessage(role, text, options) {
		if (!text) return;
		renderMessage(role, text);
		if (options && options.persist === false) return;
		var entry = { role: role, content: text };
		chatMessages.push(entry);
		if (role === 'user' || role === 'assistant') history.push(entry);
		saveAssistantState();
	}
	function isGenericActionReply(reply) {
		var clean = String(reply || '').trim();
		return !clean || clean === 'I have prepared a suggested next action for you.';
	}
	function navigationMessage(action, reply) {
		var cleanReply = String(reply || '').trim();
		if (cleanReply && cleanReply !== 'I have prepared a suggested next action for you.') return cleanReply;
		return 'Taking you to ' + (action.label || 'the requested screen') + '.';
	}
	function performNavigationAction(action, options) {
		var targetUrl = navigationTargetUrl(action);
		if (!targetUrl) return false;
		if (sameNavigationUrl(targetUrl, window.location.href)) return false;
		var pendingMessage = options && options.pendingMessage ? String(options.pendingMessage).trim() : '';
		if (pendingMessage) {
			pendingNavigation = { message: pendingMessage.slice(0, 1200), targetUrl: targetUrl, label: String(action.label || 'the requested screen').slice(0, 120), createdAt: Date.now(), attempts: 0 };
		} else if (!options || options.clearPending !== false) {
			pendingNavigation = null;
		}
		var message = options && options.message === false ? '' : navigationMessage(action, options ? options.reply : '');
		if (message) {
			var lastMessage = chatMessages[chatMessages.length - 1];
			if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.content !== message) addMessage('assistant', message);
		}
		toggle(true, { persist: false });
		saveAssistantState({ open: true });
		window.location.assign(targetUrl);
		return true;
	}
	function restoreAssistantState() {
		var state = readAssistantState();
		pendingNavigation = state.pendingNavigation && typeof state.pendingNavigation === 'object' ? state.pendingNavigation : null;
		var savedMessages = Array.isArray(state.messages) ? state.messages : [];
		if (messages && savedMessages.length) {
			messages.innerHTML = '';
			chatMessages.splice(0, chatMessages.length);
			history.splice(0, history.length);
			savedMessages.slice(-50).forEach(function (message) {
				if (!message || (message.role !== 'user' && message.role !== 'assistant') || !message.content) return;
				var entry = { role: message.role, content: String(message.content).slice(0, 2000) };
				renderMessage(entry.role, entry.content);
				chatMessages.push(entry);
			});
			(Array.isArray(state.history) ? state.history : chatMessages).slice(-16).forEach(function (message) {
				if (!message || (message.role !== 'user' && message.role !== 'assistant') || !message.content) return;
				history.push({ role: message.role, content: String(message.content).slice(0, 2000) });
			});
			updateMessagesLayout();
		}
		if (state.open) toggle(true, { persist: false });
		saveAssistantState();
	}
	function addAction(action) {
		if (!messages || !action || !action.type) return;
		var node = document.createElement('div');
		node.className = 'ven-support-assistant__action';
		var title = document.createElement('strong');
		title.textContent = action.label || 'Suggested action';
		node.appendChild(title);
		var detail = document.createElement('p');
		if (action.type === 'navigate_site') {
			if (performNavigationAction(action)) return;
			detail.textContent = action.reason || 'This screen is already open.';
			node.appendChild(detail);
		} else if (action.type === 'annotate_screen') {
			detail.textContent = action.instructions || 'I can show you where to look on this screen.';
			var annotateButton = document.createElement('button');
			annotateButton.type = 'button';
			annotateButton.textContent = action.label || 'Show me';
			annotateButton.addEventListener('click', function () { showAnnotation(action); });
			node.appendChild(detail);
			node.appendChild(annotateButton);
			window.setTimeout(function () { showAnnotation(action); }, 250);
		} else if (action.type === 'propose_page_change') {
			detail.textContent = [action.target, action.changeSummary].filter(Boolean).join(': ');
			node.appendChild(detail);
			if (action.proposedText) {
				var text = document.createElement('pre');
				text.textContent = action.proposedText;
				node.appendChild(text);
			}
		} else if (action.type === 'update_post_data') {
			detail.textContent = action.summary || 'Review and apply this WordPress update.';
			var preview = document.createElement('pre');
			preview.textContent = Object.keys(action.fields || {}).map(function (field) { return field + ': ' + String(action.fields[field]).slice(0, 500); }).join('\n\n');
			var updateButton = document.createElement('button');
			updateButton.type = 'button';
			updateButton.textContent = action.label || 'Apply update';
			updateButton.addEventListener('click', function () { applyUpdate(action, updateButton, detail); });
			node.appendChild(detail);
			if (preview.textContent) node.appendChild(preview);
			node.appendChild(updateButton);
		} else if (action.type === 'support_ticket_created') {
			detail.textContent = action.message || 'A Ven team member will follow up from ClickUp.';
			node.appendChild(detail);
			if (action.taskUrl) {
				var link = document.createElement('a');
				link.href = action.taskUrl;
				link.target = '_blank';
				link.rel = 'noopener';
				link.textContent = 'Open ClickUp task';
				node.appendChild(link);
			}
		} else if (action.type === 'support_ticket_failed') {
			detail.textContent = action.message || 'Ven support could not create a ClickUp task.';
			node.appendChild(detail);
		}
		messages.appendChild(node);
		updateMessagesLayout();
	}
	function endpoint(path) {
		return String(config.restUrl).replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
	}
	async function postJson(path, payload) {
		var response = await fetch(endpoint(path), {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce },
			body: JSON.stringify(payload || {})
		});
		var data = null;
		try { data = await response.json(); } catch (error) { data = {}; }
		if (!response.ok) {
			throw new Error((data && data.message) || 'Ven support is unavailable.');
		}
		return data || {};
	}
	async function applyUpdate(action, button, detail) {
		button.disabled = true;
		button.textContent = 'Applying...';
		try {
			var data = await postJson('apply-update', { update: action });
			detail.textContent = data.message || 'WordPress data updated.';
			button.remove();
		} catch (error) {
			button.disabled = false;
			button.textContent = action.label || 'Apply update';
			addMessage('assistant', error.message || 'The update could not be applied.');
		}
	}
	async function requestAssistantReply(message, options) {
		options = options || {};
		var cleanMessage = String(message || '').trim();
		if (!cleanMessage) return;
		if (options.addUser !== false) addMessage('user', cleanMessage);
		if (options.textarea) options.textarea.value = '';
		var wait = options.wait || 'Thinking...';
		addMessage('assistant', wait, { persist: false });
		try {
			var data = await postJson('chat', {
				message: cleanMessage,
				history: history.slice(-10),
				current_url: window.location.href,
				page_title: document.title || '',
				screen_context: collectScreenContext()
			});
			var last = messages ? messages.lastElementChild : null;
			if (last && last.textContent === wait) last.remove();
			var actions = Array.isArray(data.actions) ? data.actions : [];
			var navigationAction = actions.find(function (action) {
				var targetUrl = navigationTargetUrl(action);
				return targetUrl && !sameNavigationUrl(targetUrl, window.location.href);
			});
			if (navigationAction && performNavigationAction(navigationAction, { reply: data.reply, pendingMessage: options.pendingMessage || cleanMessage })) return;
			var reply = data.reply || 'I have prepared a suggested next action for you.';
			if (!(options.continuation && actions.length && isGenericActionReply(reply))) addMessage('assistant', reply);
			if (actions.length) actions.forEach(addAction);
			if (options.continuation) {
				pendingNavigation = null;
				saveAssistantState();
			}
		} catch (error) {
			var waiting = messages ? messages.lastElementChild : null;
			if (waiting && waiting.textContent === wait) waiting.remove();
			addMessage('assistant', error.message || 'Ven support is unavailable.');
			if (options.continuation) {
				pendingNavigation = null;
				saveAssistantState();
			}
		}
	}
	function resumePendingNavigation() {
		if (!pendingNavigation || !pendingNavigation.message) return;
		if (Date.now() - Number(pendingNavigation.createdAt || 0) > 2 * 60 * 1000) {
			pendingNavigation = null;
			saveAssistantState();
			return;
		}
		if (pendingNavigation.targetUrl && !sameNavigationUrl(pendingNavigation.targetUrl, window.location.href)) return;
		if (Number(pendingNavigation.attempts || 0) >= 2) {
			pendingNavigation = null;
			saveAssistantState();
			return;
		}
		var originalMessage = String(pendingNavigation.message || '').slice(0, 1200);
		pendingNavigation = Object.assign({}, pendingNavigation, { attempts: Number(pendingNavigation.attempts || 0) + 1 });
		saveAssistantState();
		var prompt = [
			'Continue the user request after navigation.',
			'Original user request: "' + originalMessage + '"',
			'You are now on: ' + (document.title || window.location.href),
			'Use the current screen context. If the relevant setting, field, or control is visible, call annotate_screen with the exact visible element. Do not repeat the same navigation unless this is still the wrong screen.'
		].join('\n');
		window.setTimeout(function () {
			requestAssistantReply(prompt, { addUser: false, continuation: true, pendingMessage: originalMessage, wait: 'Finding it...' });
		}, 350);
	}
	var chatForm = root.querySelector('[data-ven-chat-form]');
	if (chatForm) {
		chatForm.addEventListener('submit', function (event) {
			event.preventDefault();
			var message = input ? input.value.trim() : '';
			if (!message) return;
			requestAssistantReply(message, { textarea: input, pendingMessage: message });
		});
	}
	if (input) {
		input.addEventListener('keydown', function (event) {
			if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
			event.preventDefault();
			if (chatForm.requestSubmit) chatForm.requestSubmit();
			else chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		});
	}
	restoreAssistantState();
	resumePendingNavigation();
	}
	if (document.body) {
		bootVenSupportWidget();
	} else {
		document.addEventListener('DOMContentLoaded', bootVenSupportWidget, { once: true });
	}
})();`;
}
