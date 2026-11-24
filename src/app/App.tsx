import { lazy, Suspense } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import LocalStorageSyncWrapper from '@/components/localStorage-sync-wrapper';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { useAccountSwitching } from '@/hooks/useAccountSwitching';
import { useLanguageFromURL } from '@/hooks/useLanguageFromURL';
import { useOAuthCallback } from '@/hooks/useOAuthCallback';
import { StoreProvider } from '@/hooks/useStore';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { restoreAdminAuth } from '@/services/admin-supabase-auth';
import { initializeAdminBalanceSync } from '@/services/admin-sim-balance-sync';
import { exitAdminTest, hydrateAdminTestBalances, isAdminTestRequested } from '@/services/admin-test-kit';
import SecretAdmin from '@/pages/secret-admin/secret-admin';
import { initializeI18n, localize, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));

// Translations CDN is optional — requires TRANSLATIONS_CDN_URL, R2_PROJECT_NAME, and CROWDIN_BRANCH_NAME env vars.
// Without these, the app defaults to English. See user-guide/03-white-labeling.md#translations for setup instructions.
const i18nInstance = initializeI18n({ cdnUrl: '' });

/**
 * Component wrapper to handle language URL parameter
 * Uses the useLanguageFromURL hook to process language switching
 */
const LanguageHandler = ({ children }: { children: React.ReactNode }) => {
    useLanguageFromURL();
    return <>{children}</>;
};

const router = createBrowserRouter(
    createRoutesFromElements(
        <>
        <Route path='/secret-admin' element={<SecretAdmin />} />
        <Route
            path='/'
            element={
                <Suspense
                    fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}
                >
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <LanguageHandler>
                            <StoreProvider>
                                <LocalStorageSyncWrapper>
                                    <RoutePromptDialog />
                                    <CoreStoreProvider>
                                        <Layout />
                                    </CoreStoreProvider>
                                </LocalStorageSyncWrapper>
                            </StoreProvider>
                        </LanguageHandler>
                    </TranslationProvider>
                </Suspense>
            }
        >
            {/* All child routes will be passed as children to Layout */}
            <Route index element={<AppRoot />} />
            <Route path='bulk-trader' element={<Navigate to='/#bulk_trader' replace />} />
        </Route>
        </>
    )
);

/** Always verify the Supabase access token and restore queued balances before
 * any simulated Deriv socket, Bot Builder or Bulk Trader is mounted.
 */
const AdminSessionGate = ({ children }: { children: React.ReactNode }) => {
    const [ready, setReady] = React.useState(() => !isAdminTestRequested());
    React.useEffect(() => {
        if (!isAdminTestRequested()) return;
        let mounted = true;
        void (async () => {
            try {
                const user = await restoreAdminAuth();
                if (!user) throw new Error('Admin login expired');
                await initializeAdminBalanceSync(hydrateAdminTestBalances);
            } catch (error) {
                console.warn('Supabase admin session could not be restored:', error);
                // Never allow a cached browser flag to start the simulated transport.
                exitAdminTest(true);
            } finally {
                if (mounted) setReady(true);
            }
        })();
        return () => { mounted = false; };
    }, []);
    if (!ready) return <ChunkLoader message='Verifying simulated admin session…' />;
    return <>
        {isAdminTestRequested() && <div role='status' style={{
            position: 'fixed', bottom: '72px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 2147483647, background: '#252b36', color: '#fff', border: '1px solid #8993a2',
            borderRadius: '999px', padding: '4px 10px', fontSize: '13px', fontWeight: 600,
            lineHeight: '18px', textAlign: 'center', width: 'max-content', maxWidth: '94vw', pointerEvents: 'none',
        }}>Paper trading · Simulated funds &amp; results</div>}
        {children}
    </>;
};

/**
 * Main App component
 *
 * Responsibilities:
 * 1. OAuth callback handling (via useOAuthCallback hook)
 * 2. Account switching from URL (via useAccountSwitching hook)
 * 3. Router provider setup
 *
 * All complex logic has been extracted into custom hooks for better maintainability
 */
function App() {
    // Handle OAuth callback flow (CSRF validation + code extraction)
    const { isProcessing, isValid, params, error, cleanupURL } = useOAuthCallback();

    const [ownerError, setOwnerError] = React.useState(false);

    // Handle account switching via URL parameter
    useAccountSwitching();

    // Process the authorization code when OAuth callback is valid
    React.useEffect(() => {
        if (!isProcessing && isValid && params.code) {
            // Exchange authorization code for access token
            OAuthTokenExchangeService.exchangeCodeForToken(params.code)
                .then(response => {
                    if (response.admin_auto_simulation) {
                        cleanupURL();
                        window.location.replace('/');
                    } else if (response.access_token) {
                        cleanupURL();
                    } else if (response.error) {
                        if (response.error.startsWith('owner_')) setOwnerError(true);
                        console.error('❌ Token exchange failed:', response.error);
                        console.error('Error description:', response.error_description);
                        // Clean up URL even on error
                        cleanupURL();
                    }
                })
                .catch(error => {
                    console.error('❌ Token exchange request failed:', error);
                    // Clean up URL even on error
                    cleanupURL();
                });
        } else if (!isProcessing && error) {
            console.error('OAuth callback error:', error);
        }
    }, [isProcessing, isValid, params.code, error, cleanupURL]);

    if (ownerError) return <main style={{ padding: '24px', fontSize: '16px' }}>
        <h1>Simulation sign-in could not be completed</h1>
        <p>No live trading session was started. Check the test deployment configuration or use the manual simulator sign-in.</p>
        <a href='/secret-admin'>Open simulated trading sign-in</a>
    </main>;
    return <AdminSessionGate><RouterProvider router={router} /></AdminSessionGate>;
}

export default App;
