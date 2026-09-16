import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = GameRootViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// The game owns the whole screen in landscape: no status bar, and the home indicator fades out after a
/// moment (a swipe up from the bottom edge still goes home, but the first swipe only reveals the bar, so a
/// thumb on the touch pad near the edge does not leave the game).
///
/// UIKit asks the window's ROOT view controller about the home indicator, and CAPBridgeViewController
/// declares `prefersHomeIndicatorAutoHidden` public rather than open, so it cannot be overridden in a
/// subclass. The bridge is embedded as a child of this container instead, which answers for it.
class GameRootViewController: UIViewController {
    let bridge = GameBridgeViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        addChild(bridge)
        bridge.view.frame = view.bounds
        bridge.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(bridge.view)
        bridge.didMove(toParent: self)
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .bottom }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var childForStatusBarHidden: UIViewController? { nil }
    override var childForHomeIndicatorAutoHidden: UIViewController? { nil }
    override var childForScreenEdgesDeferringSystemGestures: UIViewController? { nil }
}

/// The Capacitor bridge, painted black behind the page so no white shows during launch or rotation.
class GameBridgeViewController: CAPBridgeViewController {
    override var prefersStatusBarHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        webView?.isOpaque = false
        webView?.backgroundColor = .black
        webView?.scrollView.backgroundColor = .black
        webView?.scrollView.bounces = false
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }
}
