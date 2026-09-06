import '../../styles/entry.css';

interface EntryPointProps {
  onKnowDestination: () => void;
  onWantSuggestions: () => void;
}

export function EntryPoint({
  onKnowDestination,
  onWantSuggestions,
}: EntryPointProps) {
  return (
    <div className="entry">
      <nav className="entry-nav">
        <div className="brand-mark">Travel Agent</div>
        <span>AI itinerary planner</span>
      </nav>
      <section className="entry-hero">
        <div className="entry-hero-media" aria-hidden />
        <div className="entry-copy">
          <div className="brand-mark">Travel Agent</div>
          <h1>Do you have a destination in mind, or would you like some suggestions?</h1>
          <p>
            Build a day-by-day trip that stays geographically compact — then watch
            the agent revise itself when a day spreads too far.
          </p>
          <div className="entry-actions">
            <button type="button" className="btn btn-primary" onClick={onKnowDestination}>
              Yes — I know where
            </button>
            <button type="button" className="btn btn-ghost" onClick={onWantSuggestions}>
              No — show me options
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
