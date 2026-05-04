import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Placeholder shell for the patient detail dashboard. F3 replaces the body
// with the tabbed Live / Floor Plan / Map / Alerts / Settings layout.
export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <Link
            to="/patients"
            className="inline-flex items-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Roster
          </Link>
        </header>
        <Card>
          <CardHeader>
            <CardTitle className="font-serif italic text-2xl">Patient {id}</CardTitle>
            <CardDescription>
              F3 lands the tabbed dashboard here (Live / Floor Plan / Map / Alerts / Settings).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Until then, this page confirms the route works.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
