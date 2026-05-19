<?php
/**
 * Plugin Name: Ven Support Connector
 * Plugin URI: https://ven.com.au/
 * Description: Stable Ven Agency support connector for approved WordPress websites.
 * Version: 1.4.0
 * Author: Ven Agency
 * Author URI: https://ven.com.au/
 * Text Domain: ven-support-connector
 * Requires at least: 6.0
 * Requires PHP: 8.0
 *
 * @package VenSupportConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( defined( 'VEN_SUPPORT_CONNECTOR_LOADED' ) ) {
	return;
}

define( 'VEN_SUPPORT_CONNECTOR_LOADED', true );

final class Ven_Support_Connector {
	private const VERSION      = '1.4.0';
	private const REST_NS      = 'ven-support/v1';
	private const CACHE_KEY    = 'ven_support_connector_remote_settings';
	private const CACHE_TTL    = 300;
	private const SCRIPT_HANDLE = 'ven-support-widget';

	public static function init(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_rest_routes' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_widget' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_widget' ) );
		add_action( 'admin_head', array( __CLASS__, 'hide_legacy_support_ui' ), 999 );
	}

	public static function register_rest_routes(): void {
		register_rest_route(
			self::REST_NS,
			'/session',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_session' ),
				'permission_callback' => array( __CLASS__, 'can_use_support' ),
			)
		);

		register_rest_route(
			self::REST_NS,
			'/chat',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_chat' ),
				'permission_callback' => array( __CLASS__, 'can_use_support' ),
			)
		);

		register_rest_route(
			self::REST_NS,
			'/apply-update',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'rest_apply_update' ),
				'permission_callback' => array( __CLASS__, 'can_use_support' ),
			)
		);
	}

	public static function can_use_support(): bool {
		return is_user_logged_in() && current_user_can( 'read' );
	}

	public static function enqueue_widget(): void {
		if ( ! self::can_use_support() ) {
			return;
		}

		$settings = self::remote_settings();
		if ( empty( $settings['enabled'] ) || empty( $settings['chatEnabled'] ) ) {
			return;
		}

		$widget_url = self::widget_url();
		if ( ! $widget_url ) {
			return;
		}

		wp_register_script( self::SCRIPT_HANDLE, $widget_url, array(), self::VERSION, true );
		wp_add_inline_script(
			self::SCRIPT_HANDLE,
			'window.VenSupportConnector = ' . wp_json_encode( self::bootstrap_config( $settings ) ) . ';',
			'before'
		);
		wp_enqueue_script( self::SCRIPT_HANDLE );
	}

	public static function hide_legacy_support_ui(): void {
		echo '<style id="ven-support-connector-hide-legacy">.ven-ai-support,#tw_solar_ven_support,#ven_support_assistant,#wpwrap>.ven-support-assistant{display:none!important;visibility:hidden!important;}</style>';
	}

	public static function rest_session(): WP_REST_Response {
		$settings = self::remote_settings();
		return new WP_REST_Response( self::bootstrap_config( $settings ) );
	}

	public static function rest_chat( WP_REST_Request $request ) {
		$message = sanitize_textarea_field( (string) $request->get_param( 'message' ) );
		if ( ! $message ) {
			return new WP_Error( 'ven_support_empty_message', 'Please enter a message.', array( 'status' => 400 ) );
		}

		$user           = wp_get_current_user();
		$history        = $request->get_param( 'history' );
		$screen_context = $request->get_param( 'screen_context' );
		$context        = array(
			'currentUrl'       => esc_url_raw( (string) $request->get_param( 'current_url' ) ),
			'pageTitle'        => sanitize_text_field( (string) $request->get_param( 'page_title' ) ),
			'screenId'         => sanitize_text_field( (string) $request->get_param( 'screen_id' ) ),
			'userLogin'        => $user->user_login,
			'displayName'      => $user->display_name,
			'userEmail'        => $user->user_email,
			'canManageOptions' => current_user_can( 'manage_options' ),
			'canEditPages'     => current_user_can( 'edit_pages' ),
			'screen'           => self::sanitize_screen_context( is_array( $screen_context ) ? $screen_context : array() ),
		);

		$result = self::remote_request(
			'/chat',
			array(
				'message' => $message,
				'history' => is_array( $history ) ? array_slice( $history, -8 ) : array(),
				'context' => $context,
			)
		);

		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'ven_support_gateway_failed', $result->get_error_message(), array( 'status' => 502 ) );
		}

		return new WP_REST_Response(
			array(
				'reply'   => sanitize_textarea_field( $result['reply'] ?? '' ),
				'actions' => self::sanitize_chat_actions( $result['actions'] ?? array() ),
			)
		);
	}

	public static function rest_apply_update( WP_REST_Request $request ) {
		$update = $request->get_param( 'update' );
		if ( ! is_array( $update ) || 'update_post_data' !== sanitize_key( $update['type'] ?? '' ) ) {
			return new WP_Error( 'ven_support_unsupported_update', 'This update is not supported.', array( 'status' => 400 ) );
		}

		$post_id = absint( $update['postId'] ?? 0 );
		$post    = $post_id ? get_post( $post_id ) : null;
		if ( ! $post ) {
			return new WP_Error( 'ven_support_missing_post', 'The WordPress item could not be found.', array( 'status' => 404 ) );
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error( 'ven_support_update_forbidden', 'You are not allowed to update this item.', array( 'status' => 403 ) );
		}

		$fields = self::sanitize_update_fields( $update['fields'] ?? array() );
		if ( empty( $fields ) ) {
			return new WP_Error( 'ven_support_empty_update', 'There are no supported fields to update.', array( 'status' => 400 ) );
		}

		$data = array( 'ID' => $post_id );
		if ( array_key_exists( 'title', $fields ) ) {
			$data['post_title'] = $fields['title'];
		}
		if ( array_key_exists( 'content', $fields ) ) {
			$data['post_content'] = $fields['content'];
		}
		if ( array_key_exists( 'excerpt', $fields ) ) {
			$data['post_excerpt'] = $fields['excerpt'];
		}

		$result = wp_update_post( wp_slash( $data ), true );
		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'ven_support_update_failed', $result->get_error_message(), array( 'status' => 500 ) );
		}

		return new WP_REST_Response(
			array(
				'message' => sprintf( 'Updated %s.', sanitize_text_field( get_the_title( $post_id ) ) ),
				'editUrl' => esc_url_raw( get_edit_post_link( $post_id, 'raw' ) ?: '' ),
			)
		);
	}

	private static function bootstrap_config( array $settings ): array {
		$user      = wp_get_current_user();
		$state_key = 'venSupportAssistantState:v3:' . md5( home_url( '/' ) . '|' . (int) $user->ID );

		return array(
			'version'      => self::VERSION,
			'restUrl'      => esc_url_raw( rest_url( self::REST_NS . '/' ) ),
			'nonce'        => wp_create_nonce( 'wp_rest' ),
			'siteUrl'      => esc_url_raw( home_url( '/' ) ),
			'adminUrl'     => esc_url_raw( admin_url( 'index.php' ) ),
			'stateKey'     => $state_key,
			'settings'     => array(
				'enabled'         => ! empty( $settings['enabled'] ),
				'chatEnabled'     => ! empty( $settings['chatEnabled'] ),
				'ticketsEnabled'  => ! empty( $settings['ticketsEnabled'] ),
				'title'           => sanitize_text_field( $settings['title'] ?? 'Ven Support' ),
				'intro'           => sanitize_text_field( $settings['intro'] ?? 'Ask Ven for help with this website.' ),
				'chatPlaceholder' => sanitize_text_field( $settings['chatPlaceholder'] ?? 'Ask about this website...' ),
			),
			'user'         => array(
				'login'       => $user->user_login,
				'displayName' => $user->display_name,
				'email'       => $user->user_email,
			),
			'capabilities' => array(
				'manageOptions' => current_user_can( 'manage_options' ),
				'editPages'     => current_user_can( 'edit_pages' ),
				'editPosts'     => current_user_can( 'edit_posts' ),
			),
		);
	}

	private static function remote_settings(): array {
		$cached = get_transient( self::CACHE_KEY );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$response = self::remote_request( '/site-config', array( 'siteUrl' => home_url( '/' ) ), 8 );
		if ( is_wp_error( $response ) ) {
			set_transient( self::CACHE_KEY, array( 'enabled' => false ), 60 );
			return array( 'enabled' => false );
		}

		$settings = array(
			'enabled'         => ! empty( $response['enabled'] ),
			'chatEnabled'     => ! empty( $response['chatEnabled'] ),
			'ticketsEnabled'  => ! empty( $response['ticketsEnabled'] ),
			'title'           => sanitize_text_field( $response['title'] ?? 'Ven Support' ),
			'intro'           => sanitize_text_field( $response['intro'] ?? 'Ask Ven for help with this website.' ),
			'chatPlaceholder' => sanitize_text_field( $response['chatPlaceholder'] ?? 'Ask about this website...' ),
		);

		set_transient( self::CACHE_KEY, $settings, self::CACHE_TTL );
		return $settings;
	}

	private static function remote_request( string $path, array $payload, int $timeout = 20 ) {
		$gateway_url = self::config_value( 'VEN_SUPPORT_GATEWAY_URL' ) ?: self::config_value( 'TW_SOLAR_SUPPORT_GATEWAY_URL' );
		$site_id     = self::config_value( 'VEN_SUPPORT_SITE_ID' ) ?: self::config_value( 'TW_SOLAR_SUPPORT_SITE_ID' );
		$site_secret = self::config_value( 'VEN_SUPPORT_SITE_SECRET' ) ?: self::config_value( 'TW_SOLAR_SUPPORT_SITE_SECRET' );

		if ( ! $gateway_url || ! $site_id || ! $site_secret ) {
			return new WP_Error( 'ven_support_missing_config', 'Ven support is not authorised on this server.' );
		}

		$payload = array_merge(
			array(
				'siteUrl'  => home_url( '/' ),
				'adminUrl' => admin_url( 'index.php' ),
			),
			$payload
		);

		$body      = wp_json_encode( $payload );
		$timestamp = (string) time();
		$signature = hash_hmac( 'sha256', $timestamp . '.' . $body, $site_secret );
		$response  = wp_remote_post(
			self::gateway_url( $gateway_url, $path ),
			array(
				'headers' => array(
					'Content-Type'      => 'application/json',
					'X-Ven-Site-ID'     => $site_id,
					'X-Ven-Timestamp'   => $timestamp,
					'X-Ven-Signature'   => $signature,
					'X-Ven-Site-Origin' => home_url( '/' ),
				),
				'timeout' => $timeout,
				'body'    => $body,
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( $code < 200 || $code >= 300 || ! is_array( $data ) || empty( $data['ok'] ) ) {
			$error = is_array( $data ) && ! empty( $data['error'] ) ? sanitize_text_field( $data['error'] ) : 'Ven support is unavailable.';
			return new WP_Error( 'ven_support_gateway_failed', $error );
		}

		return $data;
	}

	private static function sanitize_chat_actions( $actions ): array {
		if ( ! is_array( $actions ) ) {
			return array();
		}

		$clean = array();
		foreach ( array_slice( $actions, 0, 3 ) as $action ) {
			if ( ! is_array( $action ) || empty( $action['type'] ) ) {
				continue;
			}

			$type = sanitize_key( $action['type'] );
			if ( 'open_admin_screen' === $type || 'navigate_site' === $type ) {
				$clean[] = array(
					'type'   => 'open_admin_screen' === $type ? 'navigate_site' : $type,
					'label'  => sanitize_text_field( $action['label'] ?? 'Open screen' ),
					'url'    => esc_url_raw( $action['url'] ?? '' ),
					'area'   => sanitize_key( $action['area'] ?? 'admin' ),
					'reason' => sanitize_text_field( $action['reason'] ?? '' ),
				);
				continue;
			}

			if ( 'annotate_screen' === $type ) {
				$clean[] = array(
					'type'         => $type,
					'label'        => sanitize_text_field( $action['label'] ?? 'Look here' ),
					'selector'     => sanitize_text_field( $action['selector'] ?? '' ),
					'instructions' => sanitize_textarea_field( $action['instructions'] ?? '' ),
					'placement'    => sanitize_key( $action['placement'] ?? 'bottom' ),
				);
				continue;
			}

			if ( 'propose_page_change' === $type ) {
				$clean[] = array(
					'type'          => $type,
					'label'         => sanitize_text_field( $action['label'] ?? 'Review proposed change' ),
					'target'        => sanitize_text_field( $action['target'] ?? '' ),
					'changeSummary' => sanitize_textarea_field( $action['changeSummary'] ?? '' ),
					'proposedText'  => sanitize_textarea_field( $action['proposedText'] ?? '' ),
					'reason'        => sanitize_textarea_field( $action['reason'] ?? '' ),
				);
				continue;
			}

			if ( 'update_post_data' === $type ) {
				$fields  = self::sanitize_update_fields( $action['fields'] ?? array() );
				$post_id = absint( $action['postId'] ?? 0 );
				if ( empty( $fields ) || ! $post_id ) {
					continue;
				}

				$clean[] = array(
					'type'     => $type,
					'label'    => sanitize_text_field( $action['label'] ?? 'Apply update' ),
					'summary'  => sanitize_textarea_field( $action['summary'] ?? '' ),
					'postId'   => $post_id,
					'postType' => sanitize_key( $action['postType'] ?? '' ),
					'fields'   => $fields,
				);
				continue;
			}

			if ( 'support_ticket_created' === $type || 'support_ticket_failed' === $type ) {
				$clean[] = array(
					'type'    => $type,
					'label'   => sanitize_text_field( $action['label'] ?? 'Ven support task' ),
					'message' => sanitize_textarea_field( $action['message'] ?? '' ),
					'summary' => sanitize_text_field( $action['summary'] ?? '' ),
					'urgency' => sanitize_key( $action['urgency'] ?? 'normal' ),
					'taskId'  => sanitize_text_field( $action['taskId'] ?? '' ),
					'taskUrl' => esc_url_raw( $action['taskUrl'] ?? '' ),
				);
			}
		}

		return $clean;
	}

	private static function sanitize_update_fields( $fields ): array {
		if ( ! is_array( $fields ) ) {
			return array();
		}

		$clean = array();
		if ( array_key_exists( 'title', $fields ) ) {
			$clean['title'] = sanitize_text_field( (string) $fields['title'] );
		}
		if ( array_key_exists( 'content', $fields ) ) {
			$clean['content'] = wp_kses_post( (string) $fields['content'] );
		}
		if ( array_key_exists( 'excerpt', $fields ) ) {
			$clean['excerpt'] = sanitize_textarea_field( (string) $fields['excerpt'] );
		}

		return $clean;
	}

	private static function sanitize_screen_context( $screen ): array {
		if ( ! is_array( $screen ) ) {
			return array();
		}

		$clean = array(
			'url'      => esc_url_raw( $screen['url'] ?? '' ),
			'title'    => sanitize_text_field( $screen['title'] ?? '' ),
			'viewport' => array(
				'width'  => absint( $screen['viewport']['width'] ?? 0 ),
				'height' => absint( $screen['viewport']['height'] ?? 0 ),
			),
			'elements' => array(),
		);

		$elements = is_array( $screen['elements'] ?? null ) ? array_slice( $screen['elements'], 0, 60 ) : array();
		foreach ( $elements as $element ) {
			if ( ! is_array( $element ) ) {
				continue;
			}

			$clean['elements'][] = array(
				'selector' => sanitize_text_field( $element['selector'] ?? '' ),
				'tag'      => sanitize_key( $element['tag'] ?? '' ),
				'role'     => sanitize_text_field( $element['role'] ?? '' ),
				'label'    => sanitize_text_field( $element['label'] ?? '' ),
				'text'     => sanitize_text_field( $element['text'] ?? '' ),
				'context'  => sanitize_text_field( $element['context'] ?? '' ),
				'href'     => esc_url_raw( $element['href'] ?? '' ),
				'id'       => sanitize_text_field( $element['id'] ?? '' ),
				'name'     => sanitize_text_field( $element['name'] ?? '' ),
				'type'     => sanitize_key( $element['type'] ?? '' ),
				'disabled' => ! empty( $element['disabled'] ),
				'readOnly' => ! empty( $element['readOnly'] ),
				'rect'     => array(
					'x'      => (int) ( $element['rect']['x'] ?? 0 ),
					'y'      => (int) ( $element['rect']['y'] ?? 0 ),
					'width'  => (int) ( $element['rect']['width'] ?? 0 ),
					'height' => (int) ( $element['rect']['height'] ?? 0 ),
				),
			);
		}

		return $clean;
	}

	private static function widget_url(): string {
		$configured = self::config_value( 'VEN_SUPPORT_WIDGET_URL' );
		if ( $configured ) {
			return esc_url_raw( $configured );
		}

		$gateway_url = self::config_value( 'VEN_SUPPORT_GATEWAY_URL' ) ?: self::config_value( 'TW_SOLAR_SUPPORT_GATEWAY_URL' );
		return $gateway_url ? self::gateway_url( $gateway_url, '/widget.js' ) : '';
	}

	private static function config_value( string $key ): string {
		if ( defined( $key ) && constant( $key ) ) {
			return (string) constant( $key );
		}

		$value = getenv( $key );
		return $value ? (string) $value : '';
	}

	private static function gateway_url( string $gateway_url, string $path ): string {
		$gateway_url = rtrim( $gateway_url, '/' );
		foreach ( array( '/support-task', '/site-config', '/chat', '/widget.js' ) as $endpoint ) {
			if ( str_ends_with( $gateway_url, $endpoint ) ) {
				$gateway_url = substr( $gateway_url, 0, -strlen( $endpoint ) );
				break;
			}
		}

		return rtrim( $gateway_url, '/' ) . '/' . ltrim( $path, '/' );
	}
}

Ven_Support_Connector::init();
