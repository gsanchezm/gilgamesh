/**
 * Temporary placeholder for views whose hi-fi build lands in a later phase of the look&feel slice,
 * so the shell nav is fully navigable without dead routes. Replaced view-by-view.
 */
export function ComingSoonScreen({ title }: { title: string }) {
  return (
    <section className="gx-coming">
      <h1 className="gx-room__title">{title}</h1>
      <p className="gx-room__sub">This view is part of this build and lands in an upcoming phase.</p>
    </section>
  );
}
