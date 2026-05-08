import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Two boundaries:
//
//   <RootErrorBoundary>           — wraps the whole app at main.tsx;
//                                   catches render throws below the
//                                   Router so even a "wrong reference"
//                                   crash in AuthProvider gets a
//                                   recoverable fallback.
//   <TabErrorBoundary>            — wraps a single tab's content so a
//                                   crash in (say) FloorPlanCanvas
//                                   doesn't blank the whole patient
//                                   page; caregiver can switch tabs.

function RootFallback({ error, resetErrorBoundary }: FallbackProps) {
  // Item 136: the fallback may render above the Router (boundary lives in
  // main.tsx wrapping AuthProvider + BrowserRouter), so a conditional
  // useNavigate inside try/catch was always brittle and required an
  // eslint-disable for rules-of-hooks. window.location is the right tool
  // — the page is already broken and a hard navigation guarantees a fresh
  // tree.
  function goHome() {
    resetErrorBoundary();
    window.location.assign('/');
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            The dashboard hit an unexpected error. Try again, or go back to your patients.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="max-h-32 overflow-auto rounded-md border border-border/60 bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground">
            {(error as Error)?.message || 'Unknown error'}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button onClick={resetErrorBoundary} className="gap-2">
              <RotateCw className="h-4 w-4" />
              Try again
            </Button>
            <Button variant="outline" onClick={goHome}>
              Go to dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function logError(error: Error, info: ErrorInfo) {
  // Console-only for V1; a future production-hardening item should pipe
  // these into a structured log sink (Vercel Analytics, Logflare, etc.).
  console.error('[error-boundary]', error, info.componentStack);
}

interface Props {
  children: ReactNode;
}

export function RootErrorBoundary({ children }: Props) {
  return (
    <ErrorBoundary FallbackComponent={RootFallback} onError={logError}>
      {children}
    </ErrorBoundary>
  );
}

// Per-tab boundary: render a smaller fallback inside the layout so the
// navbar stays visible. Class component used here so the fallback can
// re-render without losing the AppLayout chrome around it.
interface TabBoundaryState {
  error: Error | null;
}

interface TabBoundaryProps {
  children: ReactNode;
  /** A label for the tab — used in the fallback copy. */
  label: string;
}

export class TabErrorBoundary extends Component<TabBoundaryProps, TabBoundaryState> {
  override state: TabBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): TabBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logError(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <Card className="my-4">
          <CardHeader>
            <span className="inline-flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              The {this.props.label} tab crashed
            </span>
            <CardDescription>
              {this.state.error.message || 'Unknown error'} — your other tabs still work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" onClick={this.reset} className="gap-2">
              <RotateCw className="h-4 w-4" />
              Reload this tab
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}
