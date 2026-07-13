import type { ReactNode } from 'react';

export interface PanelProps {
  readonly title: string;
  readonly caption?: string;
  readonly children: ReactNode;
}

export function Panel({ title, caption, children }: PanelProps): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>{title}</h2>
        {caption !== undefined && <span className="panel-caption">{caption}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
