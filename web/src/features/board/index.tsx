import { useState, type DragEvent } from 'react';
import type { Ticket, TicketStatus } from '@agent-ops/shared';
import { useAgents, useSimulation, useTickets } from '../../api/queries';
import { ScreenFrame } from '../../app/ScreenFrame';
import { useActionGate, useGatedReason } from '../../app/ActionGate';
import { Button, Checkbox, Select } from '../../ui/controls';
import { KpiTile } from '../../ui/display';
import { dropHint, NewTicketModal, useMoveTicket } from '../moves';
import { useSimulationHold } from '../simulation';
import { BoardColumn } from './BoardColumn';
import {
  ALL_AGENTS,
  clearBoardFilters,
  filterHint,
  isFiltering,
  setAgentFilter,
  setBlockedOnly,
  useBoardFilters,
} from './filters';
import {
  BOARD_COLUMNS,
  DRAG_FOOTER,
  emptyText,
  groupByStatus,
  isBlocked,
  isJustUpdated,
  matchesFilters,
} from './model';
import { TicketCard } from './TicketCard';
import styles from './Board.module.css';

interface Dragged {
  id: string;
  title: string;
  status: TicketStatus;
}

export default function Screen() {
  const tickets = useTickets();
  const agents = useAgents();
  const { data: sim } = useSimulation();
  const filters = useBoardFilters();
  const { requestMove, dialog } = useMoveTicket();
  const { paused } = useActionGate();
  const newTicketReason = useGatedReason();
  const [creating, setCreating] = useState(false);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [over, setOver] = useState<TicketStatus | null>(null);

  // UI-AC-50: the simulation holds while a card is being dragged.
  useSimulationHold(dragged !== null);

  if (tickets.isPending || agents.isPending || tickets.isError || agents.isError) {
    return (
      <ScreenFrame
        title="Board"
        screen="the Board"
        loading={tickets.isPending || agents.isPending}
        error={tickets.isError || agents.isError}
        onRetry={() => {
          void tickets.refetch();
          void agents.refetch();
        }}
      />
    );
  }

  const all = tickets.data;
  const agentList = agents.data;
  const clock = sim?.clock;
  const filtering = isFiltering(filters);
  const visible = groupByStatus(all.filter((t) => matchesFilters(t, filters)));
  const working = new Set(
    all.filter((t) => t.status === 'in_progress' && t.assigneeId).map((t) => t.assigneeId),
  ).size;
  const blockedCount = all.filter(isBlocked).length;

  const startDrag = (ticket: Ticket, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData('text/plain', ticket.id);
    event.dataTransfer.effectAllowed = 'move';
    setDragged({ id: ticket.id, title: ticket.title, status: ticket.status });
  };
  const endDrag = () => {
    setDragged(null);
    setOver(null);
  };

  const dragOver = (status: TicketStatus) => (event: DragEvent<HTMLElement>) => {
    if (!dragged || dragged.status === status) return;
    event.preventDefault(); // marks the column as a drop target
    event.dataTransfer.dropEffect = 'move';
    if (over !== status) setOver(status);
  };
  const dragLeave = (status: TicketStatus) => (event: DragEvent<HTMLElement>) => {
    if (over === status && !event.currentTarget.contains(event.relatedTarget as Node | null))
      setOver(null);
  };
  const drop = (status: TicketStatus) => (event: DragEvent<HTMLElement>) => {
    if (!dragged || dragged.status === status) return; // own column or outside: nothing (UI-AC-49)
    event.preventDefault();
    const ticket = all.find((t) => t.id === dragged.id);
    endDrag();
    if (ticket) requestMove(ticket, status); // table-driven: command, modal or refusal toast
  };

  const hintLine = dragged
    ? `Moving ${dragged.id} — highlighted columns accept it.`
    : filterHint(filters);

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <h1 className={styles.title}>Board</h1>
        <div className={styles.kpis}>
          <KpiTile label="Tickets" value={all.length} />
          <KpiTile label="Agents working" value={working} />
          <KpiTile label="■ Blocked" value={blockedCount} attn />
        </div>
        <div className={styles.controls}>
          <Select
            label="Agent"
            value={filters.agentId}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value={ALL_AGENTS}>All agents</option>
            {agentList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id}
              </option>
            ))}
          </Select>
          <Checkbox
            label="Blocked only"
            checked={filters.blockedOnly}
            onChange={(e) => setBlockedOnly(e.target.checked)}
          />
          {filtering && <Button onClick={clearBoardFilters}>Clear filters</Button>}
          <Button
            variant="primary"
            disabledReason={newTicketReason}
            onClick={() => setCreating(true)}
          >
            + New ticket
          </Button>
        </div>
      </div>
      <p className={styles.hint} aria-live="polite">
        {hintLine}
      </p>
      <div className={styles.scroller}>
        <div className={styles.grid}>
          {BOARD_COLUMNS.map((status) => {
            const cards = visible[status];
            const hint = dragged ? dropHint(dragged.status, status) : null;
            return (
              <BoardColumn
                key={status}
                status={status}
                count={cards.length}
                hint={hint}
                hovered={over === status}
                empty={cards.length === 0 ? emptyText(status, filtering) : null}
                onDragOver={dragOver(status)}
                onDragLeave={dragLeave(status)}
                onDrop={drop(status)}
              >
                {cards.map((t) => (
                  <TicketCard
                    key={t.id}
                    ticket={t}
                    agent={agentList.find((a) => a.id === t.assigneeId)}
                    clock={clock}
                    blocked={isBlocked(t)}
                    updated={isJustUpdated(t, clock)}
                    dragging={dragged?.id === t.id}
                    draggable={!paused}
                    onDragStart={startDrag}
                    onDragEnd={endDrag}
                  />
                ))}
              </BoardColumn>
            );
          })}
        </div>
      </div>
      <p className={styles.footer}>{DRAG_FOOTER}</p>
      {creating && <NewTicketModal onClose={() => setCreating(false)} />}
      {dialog}
    </div>
  );
}
