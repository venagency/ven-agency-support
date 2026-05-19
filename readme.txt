=== Ven Agency Support ===
Contributors: venagency
Tags: support, admin, chatbot
Requires at least: 6.0
Tested up to: 6.9
Requires PHP: 8.0
Stable tag: 1.4.0
License: GPLv2 or later

Ven Agency support assistant for authorised WordPress websites.

== Description ==

Ven Agency Support adds a remotely controlled support assistant to authorised WordPress websites.

WordPress handles the authenticated admin UI, signed requests, support uploads, and optional temporary access grants. Ven-controlled Cloudflare infrastructure handles site authorisation, AI responses, feature flags, and support task routing.

== Installation ==

1. Install the release zip.
2. Activate Ven Agency Support.
3. Configure `VEN_SUPPORT_GATEWAY_URL`, `VEN_SUPPORT_SITE_ID`, and `VEN_SUPPORT_SITE_SECRET`.

== Changelog ==

= 1.4.0 =
* Adds the Ven Support MU connector for one-install WordPress sites.
* Serves the support widget from the Cloudflare Worker at `/widget.js`.
* Updates local development to test the connector without activating a normal plugin.

= 1.3.14 =
* Creates ClickUp support tasks directly when users ask for Ven or human support.
* Adds contact-follow-up context to AI-created support tasks.

= 1.3.13 =
* Continues location questions after automatic navigation so the assistant can highlight the exact field on the destination screen.

= 1.3.12 =
* Persists chat transcripts across admin navigation, reloads, and browser sessions using a site/user-scoped local store.

= 1.3.11 =
* Improves screen context for WordPress form fields so annotations can target exact labeled controls.

= 1.3.10 =
* Keeps the assistant open and restores the chat transcript after same-site navigation.
* Prevents transient thinking messages from being saved in chat history.

= 1.3.9 =
* Makes admin-screen navigation actions move the user immediately instead of rendering suggestion cards.
* Normalizes legacy admin-screen tool calls into the same direct navigation path.

= 1.3.8 =
* Sends sanitized screen context to the AI so it can understand visible admin controls.
* Adds screen annotations that highlight visible elements and explain the next step.
* Adds confirmed post and page data updates for title, content, and excerpt fields.

= 1.3.7 =
* Adds an AI navigation tool that can take users to safe same-site admin or frontend screens.
* Keeps navigation actions constrained to the current WordPress site origin.

= 1.3.6 =
* Sends chat messages when Enter is pressed, while preserving Shift+Enter for new lines.
* Removes the visible support request tab and lets the AI route Ven-needed work into ClickUp.
* Stacks chat messages from the bottom and only fades older messages after the thread overflows.

= 1.3.5 =
* Allows the support popup height to adapt to the active panel content.

= 1.3.4 =
* Adds an isolated local WordPress test environment for Ven Agency Support plugin development.

= 1.3.3 =
* Reduces the support popup scale by roughly ten percent and gives the chat area a fixed-height frame.

= 1.3.2 =
* Refines the chat surface to follow a cleaner command-style support design.

= 1.3.1 =
* Removes the assistant eyebrow label and standardises the popup radius.

= 1.3.0 =
* Modernises the assistant interface with a dark command-style chat design.

= 1.2.7 =
* Reduces the circular launcher size while keeping the V mark size unchanged.

= 1.2.6 =
* Restores the popup to full size and reduces only the launcher V mark.

= 1.2.5 =
* Reduces the floating support assistant size by 40%.

= 1.2.4 =
* Switches the assistant popup to a light interface.
* Hides the tab switcher when only one support mode is enabled.

= 1.2.3 =
* Fixes loading panel visibility after the assistant is ready.
* Refines the floating launcher mark size.

= 1.2.2 =
* Adds floating support assistant, chat, support task flow, temporary access grants, and GitHub release updates.
