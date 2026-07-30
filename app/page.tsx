import { redirect } from 'next/navigation';

// Overview is the landing screen in the new design. The upload flow now lives
// on /sources, which Overview links to when there is no merged data yet.
export default function HomePage() {
  redirect('/overview');
}
