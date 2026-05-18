<?php
/**
 * Plugin Name: Ven Agency Support
 * Plugin URI: https://ven.com.au/
 * Description: Ven Agency support assistant for authorised WordPress websites.
 * Version: 1.3.6
 * Author: Ven Agency
 * Author URI: https://ven.com.au/
 * Text Domain: ven-agency-support
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * Update URI: https://github.com/venagency/ven-agency-support
 *
 * @package VenAgencySupport
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Ven_Agency_Support {
	private const VERSION       = '1.3.6';
	private const SLUG          = 'ven-agency-support';
	private const GITHUB_REPO   = 'venagency/ven-agency-support';
	private const CACHE_RELEASE = 'ven_agency_support_latest_release';
	private const CACHE_KEY     = 'ven_support_remote_settings';
	private const CACHE_TTL     = 300;
	private const AJAX_CHAT     = 'ven_support_chat';
	private const AJAX_TICKET   = 'ven_support_ticket';
	private const NONCE_ACTION  = 'ven_support_assistant';
	private const ACCESS_LOGIN  = 'ven-agency-support';
	private const ACCESS_EMAIL  = 'dev@ven.com.au';
	private const ACCESS_HOURS  = 2;

	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'maybe_support_login' ) );
		add_action( 'admin_init', array( __CLASS__, 'expire_support_access' ) );
		add_action( 'wp_dashboard_setup', array( __CLASS__, 'setup_dashboard' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'admin_assets' ) );
		add_action( 'admin_head', array( __CLASS__, 'hide_legacy_ai_support' ), 999 );
		add_action( 'admin_footer', array( __CLASS__, 'render_support_launcher' ) );
		add_action( 'wp_ajax_' . self::AJAX_CHAT, array( __CLASS__, 'ajax_chat' ) );
		add_action( 'wp_ajax_' . self::AJAX_TICKET, array( __CLASS__, 'ajax_ticket' ) );
		add_filter( 'wp_authenticate_user', array( __CLASS__, 'block_expired_support_user' ), 10, 2 );
		add_filter( 'admin_footer_text', array( __CLASS__, 'admin_footer_text' ) );
		add_filter( 'pre_set_site_transient_update_plugins', array( __CLASS__, 'plugin_update_check' ) );
		add_filter( 'plugins_api', array( __CLASS__, 'plugin_information' ), 20, 3 );
	}

	public static function admin_footer_text(): string {
		return 'Thank you for creating with <a href="https://ven.com.au/" target="_blank" rel="noopener">Ven</a>.';
	}

	public static function plugin_update_check( $transient ) {
		if ( ! is_object( $transient ) ) {
			return $transient;
		}

		$release = self::latest_release();
		if ( ! $release || empty( $release['version'] ) || empty( $release['download_url'] ) ) {
			return $transient;
		}

		if ( ! version_compare( $release['version'], self::VERSION, '>' ) ) {
			return $transient;
		}

		$transient->response[ self::plugin_basename() ] = (object) array(
			'id'          => 'https://github.com/' . self::GITHUB_REPO,
			'slug'        => self::SLUG,
			'plugin'      => self::plugin_basename(),
			'new_version' => $release['version'],
			'url'         => 'https://github.com/' . self::GITHUB_REPO,
			'package'     => $release['download_url'],
			'tested'      => $release['tested'] ?? '',
			'requires'    => '6.0',
			'requires_php' => '8.0',
		);

		return $transient;
	}

	public static function plugin_information( $result, string $action, object $args ) {
		if ( 'plugin_information' !== $action || empty( $args->slug ) || self::SLUG !== $args->slug ) {
			return $result;
		}

		$release = self::latest_release();
		if ( ! $release ) {
			return $result;
		}

		return (object) array(
			'name'          => 'Ven Agency Support',
			'slug'          => self::SLUG,
			'version'       => $release['version'] ?? self::VERSION,
			'author'        => '<a href="https://ven.com.au/">Ven Agency</a>',
			'homepage'      => 'https://github.com/' . self::GITHUB_REPO,
			'requires'      => '6.0',
			'requires_php'  => '8.0',
			'download_link' => $release['download_url'] ?? '',
			'sections'      => array(
				'description' => 'Ven Agency support assistant for authorised WordPress websites.',
				'changelog'   => wp_kses_post( nl2br( $release['body'] ?? '' ) ),
			),
		);
	}

	public static function setup_dashboard(): void {
		remove_meta_box( 'dashboard_quick_press', 'dashboard', 'side' );
		remove_meta_box( 'dashboard_primary', 'dashboard', 'side' );
		remove_meta_box( 'tw_solar_ven_support', 'dashboard', 'side' );
		remove_meta_box( 'ven_support_assistant', 'dashboard', 'side' );
	}

	public static function render_support_launcher(): void {
		$settings = self::remote_settings();
		if ( empty( $settings['enabled'] ) ) {
			return;
		}

		$user  = wp_get_current_user();
		$name  = get_user_meta( $user->ID, 'ven_support_name', true ) ?: $user->display_name;
		$email = get_user_meta( $user->ID, 'ven_support_email', true ) ?: $user->user_email;
		$phone = get_user_meta( $user->ID, 'ven_support_phone', true );
		$chat_enabled = ! empty( $settings['chatEnabled'] );
		$tickets_enabled = false;
		$show_tabs = false;
		if ( ! $chat_enabled ) {
			return;
		}
		?>
		<div class="ven-support-assistant" data-ven-support-assistant>
			<button type="button" class="ven-support-assistant__launcher" data-ven-launcher aria-expanded="false" aria-label="<?php esc_attr_e( 'Open Ven support', 'ven-agency-support' ); ?>">
				<img src="<?php echo esc_url( self::asset_url( 'ven-v.svg' ) ); ?>" alt="" />
			</button>

			<div class="ven-support-assistant__window" data-ven-window hidden>
				<div class="ven-support-assistant__loading" data-ven-loading>
					<img class="ven-support-assistant__logo" src="<?php echo esc_url( self::asset_url( 'ven-logo.svg' ) ); ?>" alt="<?php esc_attr_e( 'Ven', 'ven-agency-support' ); ?>" />
					<div class="ven-support-assistant__spinner" aria-hidden="true"></div>
					<p><?php esc_html_e( 'Loading Ven support...', 'ven-agency-support' ); ?></p>
				</div>

				<div class="ven-support-assistant__app" data-ven-app hidden>
					<div class="ven-support-assistant__head">
						<img class="ven-support-assistant__logo" src="<?php echo esc_url( self::asset_url( 'ven-logo.svg' ) ); ?>" alt="<?php esc_attr_e( 'Ven', 'ven-agency-support' ); ?>" />
						<button type="button" class="ven-support-assistant__close" data-ven-close aria-label="<?php esc_attr_e( 'Close Ven support', 'ven-agency-support' ); ?>">×</button>
					</div>
					<div class="ven-support-assistant__hero">
						<h2><?php esc_html_e( 'What can we help with?', 'ven-agency-support' ); ?></h2>
						<span data-ven-intro><?php echo esc_html( $settings['intro'] ?? __( 'Ask Ven for help with this website.', 'ven-agency-support' ) ); ?></span>
					</div>

					<?php if ( $show_tabs ) : ?>
						<div class="ven-support-assistant__tabs" role="tablist">
							<?php if ( $chat_enabled ) : ?>
							<button type="button" class="is-active" data-ven-tab="chat"><?php esc_html_e( 'Chat', 'ven-agency-support' ); ?></button>
							<?php endif; ?>
							<?php if ( $tickets_enabled ) : ?>
							<button type="button" data-ven-tab="ticket"><?php esc_html_e( 'Support request', 'ven-agency-support' ); ?></button>
							<?php endif; ?>
						</div>
					<?php endif; ?>

					<?php if ( $chat_enabled ) : ?>
						<section class="ven-support-assistant__panel is-active" data-ven-panel="chat">
							<div class="ven-support-assistant__messages" data-ven-messages aria-live="polite"></div>
							<form class="ven-support-assistant__chat-form" data-ven-chat-form>
								<textarea name="message" rows="3" placeholder="<?php echo esc_attr( $settings['chatPlaceholder'] ?? __( 'Ask about this website...', 'ven-agency-support' ) ); ?>" required></textarea>
								<button type="submit" class="button button-primary"><?php esc_html_e( 'Send', 'ven-agency-support' ); ?></button>
							</form>
						</section>
					<?php endif; ?>

					<?php if ( $tickets_enabled ) : ?>
						<section class="ven-support-assistant__panel <?php echo $chat_enabled ? '' : 'is-active'; ?>" data-ven-panel="ticket">
							<form class="ven-support-assistant__ticket-form" data-ven-ticket-form enctype="multipart/form-data">
								<label>
									<span><?php esc_html_e( 'Your name', 'ven-agency-support' ); ?></span>
									<input type="text" name="support_name" value="<?php echo esc_attr( $name ); ?>" required />
								</label>
								<label>
									<span><?php esc_html_e( 'Email', 'ven-agency-support' ); ?></span>
									<input type="email" name="support_email" value="<?php echo esc_attr( $email ); ?>" required />
								</label>
								<label>
									<span><?php esc_html_e( 'Phone', 'ven-agency-support' ); ?></span>
									<input type="text" name="support_phone" value="<?php echo esc_attr( $phone ); ?>" />
								</label>
								<label>
									<span><?php esc_html_e( 'What do you need help with?', 'ven-agency-support' ); ?></span>
									<textarea name="support_message" rows="8" required><?php echo esc_textarea( self::ticket_template() ); ?></textarea>
								</label>
								<label class="ven-support-assistant__upload">
									<span><?php esc_html_e( 'Upload files', 'ven-agency-support' ); ?></span>
									<input class="ven-support-assistant__file-input" type="file" name="support_files[]" multiple />
									<span class="ven-support-assistant__dropzone" tabindex="0" role="button">
										<span class="ven-support-assistant__drop-title"><?php esc_html_e( 'Drag files here or choose files', 'ven-agency-support' ); ?></span>
										<span class="ven-support-assistant__drop-hint"><?php esc_html_e( 'Screenshots, PDFs, or documents can be attached.', 'ven-agency-support' ); ?></span>
										<span class="ven-support-assistant__file-list"><?php esc_html_e( 'No files selected', 'ven-agency-support' ); ?></span>
									</span>
								</label>
								<label class="ven-support-assistant__check">
									<input type="checkbox" name="save_support_details" value="1" checked />
									<span><?php esc_html_e( 'Remember my support details for next time', 'ven-agency-support' ); ?></span>
								</label>
								<?php if ( current_user_can( 'manage_options' ) ) : ?>
									<label class="ven-support-assistant__check">
										<input type="checkbox" name="allow_ven_access" value="1" />
										<span><?php esc_html_e( 'Allow Ven temporary admin access for this support request', 'ven-agency-support' ); ?></span>
									</label>
								<?php endif; ?>
								<button type="submit" class="button button-primary"><?php esc_html_e( 'Create Support Task', 'ven-agency-support' ); ?></button>
								<p class="ven-support-assistant__status" data-ven-ticket-status aria-live="polite"></p>
							</form>
						</section>
					<?php endif; ?>
				</div>
			</div>
		</div>
		<?php
	}

	public static function ajax_chat(): void {
		self::verify_ajax_request();

		$user    = wp_get_current_user();
		$screen  = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		$message = sanitize_textarea_field( wp_unslash( $_POST['message'] ?? '' ) );
		$history = json_decode( wp_unslash( $_POST['history'] ?? '[]' ), true );
		if ( ! $message ) {
			wp_send_json_error( array( 'message' => 'Please enter a message.' ), 400 );
		}

		$context = array(
			'currentUrl'       => esc_url_raw( wp_unslash( $_POST['current_url'] ?? '' ) ),
			'pageTitle'        => sanitize_text_field( wp_unslash( $_POST['page_title'] ?? '' ) ),
			'screenId'         => $screen ? $screen->id : '',
			'userLogin'        => $user->user_login,
			'displayName'      => $user->display_name,
			'userEmail'        => $user->user_email,
			'canManageOptions' => current_user_can( 'manage_options' ),
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
			wp_send_json_error( array( 'message' => $result->get_error_message() ), 502 );
		}

		wp_send_json_success(
			array(
				'reply'   => sanitize_textarea_field( $result['reply'] ?? '' ),
				'actions' => self::sanitize_chat_actions( $result['actions'] ?? array() ),
			)
		);
	}

	public static function ajax_ticket(): void {
		self::verify_ajax_request();

		$user    = wp_get_current_user();
		$name    = sanitize_text_field( wp_unslash( $_POST['support_name'] ?? '' ) );
		$email   = sanitize_email( wp_unslash( $_POST['support_email'] ?? '' ) );
		$phone   = sanitize_text_field( wp_unslash( $_POST['support_phone'] ?? '' ) );
		$message = sanitize_textarea_field( wp_unslash( $_POST['support_message'] ?? '' ) );

		if ( ! $name || ! is_email( $email ) || ! $message ) {
			wp_send_json_error( array( 'message' => 'Please complete your name, email, and message.' ), 400 );
		}

		if ( ! empty( $_POST['save_support_details'] ) ) {
			update_user_meta( $user->ID, 'ven_support_name', $name );
			update_user_meta( $user->ID, 'ven_support_email', $email );
			update_user_meta( $user->ID, 'ven_support_phone', $phone );
		}

		$support_access = self::support_access_payload();

		$result = self::remote_request(
			'/support-task',
			array(
				'taskName'      => self::ticket_task_name( $name, $message ),
				'name'          => $name,
				'email'         => $email,
				'phone'         => $phone,
				'userLogin'     => $user->user_login,
				'siteUrl'       => home_url( '/' ),
				'adminUrl'      => admin_url( 'index.php' ),
				'submittedFrom' => wp_get_referer() ?: admin_url( 'index.php' ),
				'message'       => $message,
				'uploads'       => self::handle_uploads(),
				'supportAccess' => $support_access,
			)
		);

		if ( is_wp_error( $result ) ) {
			if ( ! empty( $support_access['granted'] ) ) {
				self::revoke_support_access();
			}
			wp_send_json_error( array( 'message' => $result->get_error_message() ), 502 );
		}

		$message = 'Support task created in ClickUp.';
		if ( ! empty( $support_access['granted'] ) ) {
			$message .= sprintf( ' Temporary Ven access is enabled until %s.', sanitize_text_field( $support_access['expiresAt'] ?? '' ) );
		}

		wp_send_json_success(
			array(
				'message'       => $message,
				'taskUrl'       => esc_url_raw( $result['taskUrl'] ?? '' ),
				'supportAccess' => ! empty( $support_access['granted'] ),
			)
		);
	}

	public static function maybe_support_login(): void {
		$token = sanitize_text_field( wp_unslash( $_GET['ven_support_access'] ?? '' ) );
		if ( ! $token ) {
			return;
		}

		$user = self::support_user();
		if ( ! $user || ! self::support_access_active( $user ) ) {
			wp_die(
				esc_html__( 'Ven support access has expired.', 'ven-agency-support' ),
				esc_html__( 'Ven support access expired', 'ven-agency-support' ),
				array( 'response' => 403 )
			);
		}

		$expected = (string) get_user_meta( $user->ID, 'ven_support_access_token_hash', true );
		$actual   = hash( 'sha256', $token );
		if ( ! $expected || ! hash_equals( $expected, $actual ) ) {
			wp_die(
				esc_html__( 'Ven support access is invalid.', 'ven-agency-support' ),
				esc_html__( 'Ven support access invalid', 'ven-agency-support' ),
				array( 'response' => 403 )
			);
		}

		delete_user_meta( $user->ID, 'ven_support_access_token_hash' );
		wp_set_current_user( $user->ID );
		wp_set_auth_cookie( $user->ID, false, is_ssl() );
		wp_safe_redirect( admin_url( 'index.php' ) );
		exit;
	}

	public static function expire_support_access(): void {
		$user = self::support_user();
		$expires = $user ? (int) get_user_meta( $user->ID, 'ven_support_access_expires', true ) : 0;
		if ( $user && $expires && $expires <= time() ) {
			self::revoke_support_access( $user );
		}
	}

	public static function block_expired_support_user( $user, string $password ) {
		if ( ! $user instanceof WP_User ) {
			return $user;
		}

		if ( self::ACCESS_LOGIN !== $user->user_login ) {
			return $user;
		}

		if ( self::support_access_active( $user ) ) {
			return $user;
		}

		return new WP_Error( 'ven_support_access_expired', __( 'Ven support access has expired.', 'ven-agency-support' ) );
	}

	public static function admin_assets(): void {
		$settings = self::remote_settings();
		if ( empty( $settings['enabled'] ) ) {
			return;
		}

		wp_register_style( 'ven-agency-support-admin', false, array(), self::VERSION );
		wp_enqueue_style( 'ven-agency-support-admin' );
		wp_register_script( 'ven-agency-support-admin', false, array(), self::VERSION, true );
		wp_enqueue_script( 'ven-agency-support-admin' );

		wp_add_inline_style( 'ven-agency-support-admin', self::css() );
		wp_add_inline_script(
			'ven-agency-support-admin',
			'window.venSupportAssistant = ' . wp_json_encode(
				array(
					'ajaxUrl'        => admin_url( 'admin-ajax.php' ),
					'nonce'          => wp_create_nonce( self::NONCE_ACTION ),
					'chatAction'     => self::AJAX_CHAT,
					'ticketAction'   => self::AJAX_TICKET,
					'chatEnabled'    => ! empty( $settings['chatEnabled'] ),
					'ticketsEnabled' => ! empty( $settings['ticketsEnabled'] ),
				)
			) . ';' . self::js()
		);
	}

	public static function hide_legacy_ai_support(): void {
		echo '<style id="ven-agency-hide-legacy-ai-support">.ven-ai-support,#tw_solar_ven_support,#ven_support_assistant{display:none!important;visibility:hidden!important;}</style>';
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

		$intro = sanitize_text_field( $response['intro'] ?? 'Ask Ven for help with this website.' );
		if ( 'Ask Ven for help or create a support task.' === $intro ) {
			$intro = 'Ask Ven for help with this website.';
		}

		$settings = array(
			'enabled'         => ! empty( $response['enabled'] ),
			'chatEnabled'     => ! empty( $response['chatEnabled'] ),
			'ticketsEnabled'  => ! empty( $response['ticketsEnabled'] ),
			'title'           => sanitize_text_field( $response['title'] ?? 'Ven Support' ),
			'intro'           => $intro,
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
		$url       = self::gateway_url( $gateway_url, $path );
		$response  = wp_remote_post(
			$url,
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

	private static function verify_ajax_request(): void {
		if ( ! current_user_can( 'read' ) ) {
			wp_send_json_error( array( 'message' => 'You are not allowed to use Ven support.' ), 403 );
		}

		check_ajax_referer( self::NONCE_ACTION, 'nonce' );
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
			if ( 'open_admin_screen' === $type ) {
				$clean[] = array(
					'type'   => $type,
					'label'  => sanitize_text_field( $action['label'] ?? 'Open admin screen' ),
					'url'    => esc_url_raw( $action['url'] ?? '' ),
					'reason' => sanitize_text_field( $action['reason'] ?? '' ),
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

			if ( 'prepare_support_request' === $type ) {
				$clean[] = array(
					'type'    => $type,
					'label'   => sanitize_text_field( $action['label'] ?? 'Create support request' ),
					'summary' => sanitize_text_field( $action['summary'] ?? 'Website support request' ),
					'details' => sanitize_textarea_field( $action['details'] ?? '' ),
					'urgency' => sanitize_key( $action['urgency'] ?? 'normal' ),
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

	private static function support_access_payload(): array {
		if ( empty( $_POST['allow_ven_access'] ) ) {
			return array(
				'requested' => false,
				'granted'   => false,
			);
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			return array(
				'requested' => true,
				'granted'   => false,
				'message'   => 'The current WordPress user cannot grant temporary admin access.',
			);
		}

		$user = self::ensure_support_user();
		if ( is_wp_error( $user ) ) {
			return array(
				'requested' => true,
				'granted'   => false,
				'message'   => $user->get_error_message(),
			);
		}

		$expires = time() + ( self::ACCESS_HOURS * HOUR_IN_SECONDS );
		$token   = wp_generate_password( 48, false, false );
		$grantor = wp_get_current_user();

		update_user_meta( $user->ID, 'ven_support_access_expires', $expires );
		update_user_meta( $user->ID, 'ven_support_access_token_hash', hash( 'sha256', $token ) );
		update_user_meta( $user->ID, 'ven_support_access_granted_by', $grantor->user_login );
		update_user_meta( $user->ID, 'ven_support_access_granted_at', time() );
		if ( empty( get_user_meta( $user->ID, 'ven_support_access_previous_roles', true ) ) ) {
			update_user_meta( $user->ID, 'ven_support_access_previous_roles', array_values( $user->roles ) );
		}

		$user->set_role( 'administrator' );

		return array(
			'requested' => true,
			'granted'   => true,
			'userLogin' => $user->user_login,
			'email'     => self::ACCESS_EMAIL,
			'expiresAt' => gmdate( 'c', $expires ),
			'accessUrl' => add_query_arg( 'ven_support_access', rawurlencode( $token ), admin_url( 'index.php' ) ),
			'grantedBy' => $grantor->user_login,
			'duration'  => self::ACCESS_HOURS . ' hours',
		);
	}

	private static function ensure_support_user() {
		$user = self::support_user();
		if ( $user ) {
			return $user;
		}

		$user_id = wp_insert_user(
			array(
				'user_login'   => self::ACCESS_LOGIN,
				'user_pass'    => wp_generate_password( 64, true, true ),
				'user_email'   => self::ACCESS_EMAIL,
				'display_name' => 'Ven Agency Support',
				'nickname'     => 'Ven Agency Support',
				'role'         => 'subscriber',
			)
		);

		if ( is_wp_error( $user_id ) ) {
			return $user_id;
		}

		update_user_meta( $user_id, 'ven_support_access_created', 1 );
		return get_user_by( 'id', $user_id );
	}

	private static function support_user() {
		$user = get_user_by( 'login', self::ACCESS_LOGIN );
		if ( $user ) {
			return $user;
		}

		return get_user_by( 'email', self::ACCESS_EMAIL );
	}

	private static function support_access_active( WP_User $user ): bool {
		$expires = (int) get_user_meta( $user->ID, 'ven_support_access_expires', true );
		return $expires > time();
	}

	private static function revoke_support_access( ?WP_User $user = null ): void {
		$user = $user ?: self::support_user();
		if ( ! $user ) {
			return;
		}

		delete_user_meta( $user->ID, 'ven_support_access_expires' );
		delete_user_meta( $user->ID, 'ven_support_access_token_hash' );
		delete_user_meta( $user->ID, 'ven_support_access_granted_by' );
		delete_user_meta( $user->ID, 'ven_support_access_granted_at' );
		wp_update_user(
			array(
				'ID'        => $user->ID,
				'user_pass' => wp_generate_password( 64, true, true ),
			)
		);

		$previous_roles = get_user_meta( $user->ID, 'ven_support_access_previous_roles', true );
		delete_user_meta( $user->ID, 'ven_support_access_previous_roles' );

		if ( is_array( $previous_roles ) && ! empty( $previous_roles ) ) {
			$user->set_role( sanitize_key( array_shift( $previous_roles ) ) );
			foreach ( $previous_roles as $role ) {
				$user->add_role( sanitize_key( $role ) );
			}
		} else {
			$user->set_role( 'subscriber' );
		}

		if ( class_exists( 'WP_Session_Tokens' ) ) {
			WP_Session_Tokens::get_instance( $user->ID )->destroy_all();
		}
	}

	private static function handle_uploads(): array {
		if ( empty( $_FILES['support_files']['name'] ) || ! is_array( $_FILES['support_files']['name'] ) ) {
			return array();
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';

		$uploads = array();
		$files   = $_FILES['support_files'];
		$count   = count( $files['name'] );

		for ( $i = 0; $i < $count; ++$i ) {
			if ( empty( $files['name'][ $i ] ) || (int) $files['error'][ $i ] !== UPLOAD_ERR_OK ) {
				continue;
			}

			$file     = array(
				'name'     => sanitize_file_name( $files['name'][ $i ] ),
				'type'     => sanitize_mime_type( $files['type'][ $i ] ),
				'tmp_name' => $files['tmp_name'][ $i ],
				'error'    => $files['error'][ $i ],
				'size'     => $files['size'][ $i ],
			);
			$uploaded = wp_handle_upload( $file, array( 'test_form' => false ) );
			if ( ! empty( $uploaded['file'] ) ) {
				$uploads[] = array(
					'name' => basename( $uploaded['file'] ),
					'type' => sanitize_mime_type( $uploaded['type'] ?? $file['type'] ),
					'url'  => esc_url_raw( $uploaded['url'] ?? '' ),
				);
			}
		}

		return $uploads;
	}

	private static function asset_url( string $filename ): string {
		return plugin_dir_url( __FILE__ ) . 'assets/' . ltrim( $filename, '/' );
	}

	private static function plugin_basename(): string {
		return plugin_basename( __FILE__ );
	}

	private static function latest_release(): array {
		$cached = get_site_transient( self::CACHE_RELEASE );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$response = wp_remote_get(
			'https://api.github.com/repos/' . self::GITHUB_REPO . '/releases/latest',
			array(
				'timeout' => 10,
				'headers' => array(
					'Accept'     => 'application/vnd.github+json',
					'User-Agent' => 'Ven-Agency-Support-Updater/' . self::VERSION,
				),
			)
		);

		if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
			set_site_transient( self::CACHE_RELEASE, array(), HOUR_IN_SECONDS );
			return array();
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) || empty( $body['tag_name'] ) ) {
			set_site_transient( self::CACHE_RELEASE, array(), HOUR_IN_SECONDS );
			return array();
		}

		$release = array(
			'version'      => ltrim( sanitize_text_field( $body['tag_name'] ), 'vV' ),
			'download_url' => self::release_download_url( $body ),
			'body'         => sanitize_textarea_field( $body['body'] ?? '' ),
			'tested'       => sanitize_text_field( $body['tested'] ?? '' ),
		);

		set_site_transient( self::CACHE_RELEASE, $release, 6 * HOUR_IN_SECONDS );
		return $release;
	}

	private static function release_download_url( array $release ): string {
		$assets = is_array( $release['assets'] ?? null ) ? $release['assets'] : array();
		foreach ( $assets as $asset ) {
			$name = is_array( $asset ) ? (string) ( $asset['name'] ?? '' ) : '';
			$url  = is_array( $asset ) ? (string) ( $asset['browser_download_url'] ?? '' ) : '';
			if ( $url && str_ends_with( $name, '.zip' ) ) {
				return esc_url_raw( $url );
			}
		}

		return esc_url_raw( $release['zipball_url'] ?? '' );
	}

	private static function ticket_template(): string {
		return implode(
			"\n\n",
			array(
				'Describe the issue:',
				'Page or URL:',
				'What browser are you using:',
				'What device/model are you using:',
				'Steps to reproduce:',
				'Expected result:',
				'Actual result:',
				'How urgent is this:',
			)
		);
	}

	private static function ticket_task_name( string $name, string $message ): string {
		foreach ( array_filter( array_map( 'trim', explode( "\n", $message ) ) ) as $line ) {
			if ( ! str_ends_with( $line, ':' ) ) {
				return 'Website support: ' . wp_html_excerpt( $line, 80, '...' );
			}
		}

		return sprintf( 'Website support request from %s', $name );
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
		foreach ( array( '/support-task', '/site-config', '/chat' ) as $endpoint ) {
			if ( str_ends_with( $gateway_url, $endpoint ) ) {
				$gateway_url = substr( $gateway_url, 0, -strlen( $endpoint ) );
				break;
			}
		}

		return rtrim( $gateway_url, '/' ) . '/' . ltrim( $path, '/' );
	}

	private static function css(): string {
		return <<<'CSS'
.ven-support-assistant { --ven-support-radius: 24px; bottom: 24px; color: #f6f7f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; position: fixed; right: 24px; z-index: 100000; }
.ven-support-assistant__launcher { align-items: center; background: #111214; border: 1px solid rgba(255,255,255,.14); border-radius: var(--ven-support-radius); box-shadow: 0 16px 44px rgba(0,0,0,.26); cursor: pointer; display: flex; height: 38px; justify-content: center; padding: 0; transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; width: 38px; }
.ven-support-assistant__launcher:hover, .ven-support-assistant__launcher:focus { border-color: rgba(255,255,255,.32); box-shadow: 0 20px 54px rgba(0,0,0,.34); transform: translateY(-1px); }
.ven-support-assistant__launcher img { display: block; height: auto; width: 14px; }
.ven-support-assistant__window { background: linear-gradient(180deg, #171719 0%, #0d0e10 100%); border: 1px solid rgba(255,255,255,.12); border-radius: var(--ven-support-radius); bottom: 56px; box-shadow: 0 24px 80px rgba(0,0,0,.32); box-sizing: border-box; max-height: calc(100vh - 96px); overflow: auto; padding: 22px; position: absolute; right: 0; width: min(378px, calc(100vw - 48px)); }
.ven-support-assistant__app { display: flex; flex-direction: column; min-height: 0; }
.ven-support-assistant__head { align-items: center; display: flex; gap: 16px; justify-content: space-between; margin-bottom: 18px; }
.ven-support-assistant__close { align-items: center; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.08); border-radius: var(--ven-support-radius); color: rgba(255,255,255,.78); cursor: pointer; display: flex; font-size: 20px; height: 32px; justify-content: center; line-height: 1; padding: 0; transition: background .16s ease, color .16s ease; width: 32px; }
.ven-support-assistant__close:hover, .ven-support-assistant__close:focus { background: rgba(255,255,255,.14); color: #fff; }
.ven-support-assistant__logo { display: block; height: auto; margin: 0; max-width: 84px; width: 84px; }
.ven-support-assistant__hero { margin: 0 0 20px; }
.ven-support-assistant__hero h2 { color: #fff; font-size: 27px; font-weight: 520; letter-spacing: 0; line-height: 1.08; margin: 0 0 9px; }
.ven-support-assistant__hero span { color: rgba(255,255,255,.56); display: block; font-size: 13px; line-height: 1.45; }
.ven-support-assistant__loading { align-items: flex-start; display: flex; flex-direction: column; min-height: 220px; justify-content: center; }
.ven-support-assistant__loading[hidden], .ven-support-assistant__app[hidden] { display: none !important; }
.ven-support-assistant__spinner { animation: venSpin .8s linear infinite; border: 2px solid rgba(255,255,255,.2); border-top-color: #fff; border-radius: 999px; height: 28px; margin: 0 0 14px; width: 28px; }
@keyframes venSpin { to { transform: rotate(360deg); } }
.ven-support-assistant__tabs { background: rgba(255,255,255,.06); border-radius: var(--ven-support-radius); display: flex; gap: 4px; margin: 0 0 14px; padding: 4px; }
.ven-support-assistant__tabs button { background: transparent; border: 0; border-radius: var(--ven-support-radius); color: rgba(255,255,255,.62); cursor: pointer; flex: 1; font-weight: 700; padding: 8px 10px; }
.ven-support-assistant__tabs button.is-active { background: rgba(255,255,255,.14); color: #fff; }
.ven-support-assistant__panel { display: none; }
.ven-support-assistant__panel.is-active { display: block; }
.ven-support-assistant__panel[data-ven-panel="chat"].is-active { display: grid; gap: 16px; grid-template-rows: minmax(190px, 1fr) auto; min-height: min(430px, calc(100vh - 190px)); }
.ven-support-assistant__messages { background: transparent; border: 0; display: flex; flex-direction: column; gap: 10px; justify-content: flex-end; margin: 0; min-height: 0; overflow: auto; padding: 0; }
.ven-support-assistant__messages.has-overflow { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 30px, #000 100%); justify-content: flex-start; mask-image: linear-gradient(to bottom, transparent 0, #000 30px, #000 100%); }
.ven-support-assistant__message { border-radius: var(--ven-support-radius); font-size: 13px; line-height: 1.45; padding: 10px 14px; }
.ven-support-assistant__message--user { align-self: flex-end; background: #fff; color: #111214; max-width: 86%; }
.ven-support-assistant__message--assistant { align-self: flex-start; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.08); color: rgba(255,255,255,.88); max-width: 92%; }
.ven-support-assistant__action { align-self: stretch; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.10); border-radius: var(--ven-support-radius); color: rgba(255,255,255,.68); line-height: 1.45; padding: 11px 12px; }
.ven-support-assistant__action strong { color: #fff; display: block; margin-bottom: 4px; }
.ven-support-assistant__action p { margin: 0 0 8px; }
.ven-support-assistant__action pre { background: rgba(0,0,0,.22); border-radius: var(--ven-support-radius); color: #fff; margin: 8px 0; max-height: 150px; overflow: auto; padding: 8px; white-space: pre-wrap; }
.ven-support-assistant__action button, .ven-support-assistant__action a { align-items: center; background: #fff; border: 0; border-radius: var(--ven-support-radius); color: #111214; cursor: pointer; display: inline-flex; font-weight: 700; min-height: 30px; padding: 5px 12px; text-decoration: none; }
.ven-support-assistant label { display: block; margin: 0 0 14px; }
.ven-support-assistant label span { color: rgba(255,255,255,.78); display: block; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.ven-support-assistant input[type="text"], .ven-support-assistant input[type="email"], .ven-support-assistant textarea { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); border-radius: var(--ven-support-radius); box-sizing: border-box; color: #fff; max-width: 100%; outline: none; width: 100%; }
.ven-support-assistant input[type="text"]:focus, .ven-support-assistant input[type="email"]:focus, .ven-support-assistant textarea:focus { border-color: rgba(255,255,255,.34); box-shadow: 0 0 0 2px rgba(255,255,255,.08); }
.ven-support-assistant textarea { min-height: 92px; }
.ven-support-assistant__ticket-form label { margin-bottom: 10px; }
.ven-support-assistant__ticket-form textarea { min-height: 72px; }
.ven-support-assistant__chat-form { align-items: flex-end; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); border-radius: var(--ven-support-radius); box-shadow: inset 0 1px 0 rgba(255,255,255,.04); display: flex; gap: 9px; padding: 11px 11px 11px 16px; }
.ven-support-assistant__chat-form textarea { background: transparent; border: 0; border-radius: 0; box-shadow: none !important; color: #f6f7f9; flex: 1; min-height: 43px; padding: 9px 0; resize: none; }
.ven-support-assistant__chat-form textarea::placeholder { color: rgba(255,255,255,.46); }
.ven-support-assistant__chat-form .button.button-primary { align-items: center; border-radius: var(--ven-support-radius); display: inline-flex; flex: 0 0 38px; font-size: 0; height: 38px; justify-content: center; min-height: 38px; padding: 0; position: relative; width: 38px; }
.ven-support-assistant__chat-form .button.button-primary::after { content: "→"; font-size: 20px; font-weight: 500; line-height: 1; }
.ven-support-assistant__upload { cursor: pointer; }
.ven-support-assistant__file-input { height: 1px; opacity: 0; overflow: hidden; position: absolute; width: 1px; }
.ven-support-assistant__dropzone { align-items: center; background: rgba(255,255,255,.05); border: 1px dashed rgba(255,255,255,.28); border-radius: var(--ven-support-radius); box-sizing: border-box; display: flex !important; flex-direction: column; gap: 7px; justify-content: center; min-height: 112px; padding: 18px; text-align: center; transition: background .16s ease, border-color .16s ease, box-shadow .16s ease; width: 100%; }
.ven-support-assistant__ticket-form .ven-support-assistant__dropzone { gap: 5px; min-height: 82px; padding: 12px; }
.ven-support-assistant__upload.is-dragging .ven-support-assistant__dropzone, .ven-support-assistant__dropzone:focus { background: rgba(255,255,255,.10); border-color: rgba(255,255,255,.5); box-shadow: 0 0 0 2px rgba(255,255,255,.08); outline: none; }
.ven-support-assistant__drop-title { color: #fff !important; font-size: 13px !important; margin: 0 !important; }
.ven-support-assistant__drop-hint { color: rgba(255,255,255,.54) !important; font-size: 12px !important; font-weight: 500 !important; margin: 0 !important; }
.ven-support-assistant__file-list { color: rgba(255,255,255,.68) !important; font-size: 12px !important; font-weight: 600 !important; margin: 2px 0 0 !important; max-width: 100%; overflow-wrap: anywhere; }
.ven-support-assistant__check { align-items: flex-start; display: flex !important; gap: 8px; }
.ven-support-assistant__check input { margin-top: 2px; }
.ven-support-assistant__check span { font-weight: 500 !important; margin: 0 !important; }
.ven-support-assistant .button.button-primary { background: #fff; border-color: #fff; color: #111214; font-weight: 700; width: 100%; }
.ven-support-assistant .button.button-primary:hover, .ven-support-assistant .button.button-primary:focus { background: rgba(255,255,255,.86); border-color: rgba(255,255,255,.86); color: #111214; }
.ven-support-assistant__status { color: rgba(255,255,255,.68); font-weight: 700; margin: 12px 0 0; }
@media (max-width: 782px) { .ven-support-assistant { bottom: 16px; right: 16px; } .ven-support-assistant__window { bottom: 52px; max-height: calc(100vh - 84px); width: calc(100vw - 32px); } }
CSS;
	}

	private static function js(): string {
		return <<<'JS'
(function () {
	const config = window.venSupportAssistant || {};
	const root = document.querySelector('[data-ven-support-assistant]');
	if (!root) return;

	const launcher = root.querySelector('[data-ven-launcher]');
	const close = root.querySelector('[data-ven-close]');
	const win = root.querySelector('[data-ven-window]');
	const loading = root.querySelector('[data-ven-loading]');
	const app = root.querySelector('[data-ven-app]');
	if (loading) {
		loading.hidden = true;
		loading.style.display = 'none';
	}
	if (app) {
		app.hidden = false;
		app.style.display = '';
	}
	const toggle = function (open) {
		if (!win || !launcher) return;
		win.hidden = !open;
		launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
	};
	if (launcher) launcher.addEventListener('click', function () { toggle(!win || win.hidden); });
	if (close) close.addEventListener('click', function () { toggle(false); });

	const history = [];
	const messages = root.querySelector('[data-ven-messages]');
	const updateMessagesLayout = function () {
		if (!messages) return;
		const hasOverflow = messages.scrollHeight > messages.clientHeight + 1;
		messages.classList.toggle('has-overflow', hasOverflow);
		messages.scrollTop = messages.scrollHeight;
	};
	const addMessage = function (role, text) {
		if (!messages || !text) return;
		const node = document.createElement('div');
		node.className = 'ven-support-assistant__message ven-support-assistant__message--' + role;
		node.textContent = text;
		messages.appendChild(node);
		history.push({ role, content: text });
		updateMessagesLayout();
	};
	const addAction = function (action) {
		if (!messages || !action || !action.type) return;
		const node = document.createElement('div');
		node.className = 'ven-support-assistant__action';
		const title = document.createElement('strong');
		title.textContent = action.label || 'Suggested action';
		node.appendChild(title);

		const detail = document.createElement('p');
		if (action.type === 'open_admin_screen') {
			detail.textContent = action.reason || 'Open this WordPress screen to continue.';
			const link = document.createElement('a');
			link.href = action.url || '#';
			link.textContent = action.label || 'Open screen';
			node.appendChild(detail);
			node.appendChild(link);
		} else if (action.type === 'propose_page_change') {
			detail.textContent = [action.target, action.changeSummary].filter(Boolean).join(': ');
			node.appendChild(detail);
			if (action.proposedText) {
				const text = document.createElement('pre');
				text.textContent = action.proposedText;
				node.appendChild(text);
			}
			if (action.reason) {
				const reason = document.createElement('p');
				reason.textContent = action.reason;
				node.appendChild(reason);
			}
		} else if (action.type === 'prepare_support_request') {
			detail.textContent = action.details || action.summary || 'This needs Ven support.';
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = action.label || 'Create support request';
			button.addEventListener('click', function () {
				const tab = root.querySelector('[data-ven-tab="ticket"]');
				const textarea = root.querySelector('textarea[name="support_message"]');
				if (tab) tab.click();
				if (textarea) {
					textarea.value = [
						action.summary ? 'Describe the issue: ' + action.summary : '',
						action.details || '',
						action.urgency ? 'Urgency: ' + action.urgency : ''
					].filter(Boolean).join('\n\n');
					textarea.focus();
				}
			});
			node.appendChild(detail);
			node.appendChild(button);
		} else if (action.type === 'support_ticket_created') {
			detail.textContent = action.message || 'A Ven team member will follow up from ClickUp.';
			node.appendChild(detail);
			if (action.taskUrl) {
				const link = document.createElement('a');
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
	};

	root.querySelectorAll('[data-ven-tab]').forEach(function (tab) {
		tab.addEventListener('click', function () {
			root.querySelectorAll('[data-ven-tab]').forEach(function (button) { button.classList.remove('is-active'); });
			root.querySelectorAll('[data-ven-panel]').forEach(function (panel) { panel.classList.remove('is-active'); });
			tab.classList.add('is-active');
			const panel = root.querySelector('[data-ven-panel="' + tab.dataset.venTab + '"]');
			if (panel) panel.classList.add('is-active');
		});
	});

	const chatForm = root.querySelector('[data-ven-chat-form]');
	if (chatForm) {
		const chatInput = chatForm.querySelector('textarea[name="message"]');
		if (chatInput) {
			chatInput.addEventListener('keydown', function (event) {
				if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
					return;
				}

				event.preventDefault();
				if (chatForm.requestSubmit) {
					chatForm.requestSubmit();
				} else {
					chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
				}
			});
		}

		chatForm.addEventListener('submit', async function (event) {
			event.preventDefault();
			const textarea = chatForm.querySelector('textarea[name="message"]');
			const message = textarea ? textarea.value.trim() : '';
			if (!message) return;
			addMessage('user', message);
			textarea.value = '';
			const wait = 'Thinking...';
			addMessage('assistant', wait);

			const body = new FormData();
			body.append('action', config.chatAction);
			body.append('nonce', config.nonce);
			body.append('message', message);
			body.append('history', JSON.stringify(history.slice(-10)));
			body.append('current_url', window.location.href);
			body.append('page_title', document.title || '');

			try {
				const response = await fetch(config.ajaxUrl, { method: 'POST', credentials: 'same-origin', body });
				const data = await response.json();
				const last = messages ? messages.lastElementChild : null;
				if (last && last.textContent === wait) last.remove();
				addMessage('assistant', data.success ? data.data.reply : (data.data && data.data.message ? data.data.message : 'Ven support is unavailable.'));
				if (data.success && Array.isArray(data.data.actions)) {
					data.data.actions.forEach(addAction);
				}
			} catch (error) {
				const last = messages ? messages.lastElementChild : null;
				if (last && last.textContent === wait) last.remove();
				addMessage('assistant', 'Ven support is unavailable.');
			}
		});
	}

	root.querySelectorAll('.ven-support-assistant__upload').forEach(function (field) {
		const input = field.querySelector('.ven-support-assistant__file-input');
		const dropzone = field.querySelector('.ven-support-assistant__dropzone');
		const fileList = field.querySelector('.ven-support-assistant__file-list');
		if (!input || !dropzone || !fileList) return;

		const updateList = function () {
			const names = Array.from(input.files || []).map(function (file) { return file.name; });
			fileList.textContent = names.length ? names.join(', ') : 'No files selected';
		};

		field.addEventListener('dragover', function (event) {
			event.preventDefault();
			field.classList.add('is-dragging');
		});
		field.addEventListener('dragleave', function () {
			field.classList.remove('is-dragging');
		});
		field.addEventListener('drop', function (event) {
			event.preventDefault();
			field.classList.remove('is-dragging');
			if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
				input.files = event.dataTransfer.files;
				updateList();
			}
		});
		dropzone.addEventListener('keydown', function (event) {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				input.click();
			}
		});
		input.addEventListener('change', updateList);
	});

	const ticketForm = root.querySelector('[data-ven-ticket-form]');
	if (ticketForm) {
		ticketForm.addEventListener('submit', async function (event) {
			event.preventDefault();
			const status = root.querySelector('[data-ven-ticket-status]');
			const body = new FormData(ticketForm);
			body.append('action', config.ticketAction);
			body.append('nonce', config.nonce);
			if (status) status.textContent = 'Creating support task...';

			try {
				const response = await fetch(config.ajaxUrl, { method: 'POST', credentials: 'same-origin', body });
				const data = await response.json();
				if (status) status.textContent = data.success ? data.data.message : (data.data && data.data.message ? data.data.message : 'Support task could not be created.');
			} catch (error) {
				if (status) status.textContent = 'Support task could not be created.';
			}
		});
	}
})();
JS;
	}
}

Ven_Agency_Support::init();
