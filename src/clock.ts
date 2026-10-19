import { formatClock, type Round } from "./round.ts";

/**
 * Round clock at the top center of the screen, plus a "TIME UP" message in
 * the middle when the round ends.
 */
export function createClock(parent: HTMLElement = document.body) {
  const clock = document.createElement("div");
  clock.className = "clock";
  clock.setAttribute("role", "timer");
  clock.innerHTML = `
    <div class="clock-time" data-clock="time">3:00</div>
    <div class="clock-sub" data-clock="sub"></div>
  `;
  parent.appendChild(clock);

  const over = document.createElement("div");
  over.className = "time-up";
  over.hidden = true;
  over.setAttribute("role", "status");
  over.innerHTML = `
    <div class="time-up-title">TIME UP</div>
    <div class="time-up-score">GATES <span data-clock="final">0</span></div>
    <div class="time-up-hint">PRESS ENTER TO PLAY AGAIN</div>
  `;
  parent.appendChild(over);

  const time = clock.querySelector<HTMLElement>("[data-clock=time]")!;
  const sub = clock.querySelector<HTMLElement>("[data-clock=sub]")!;
  const final = over.querySelector<HTMLElement>("[data-clock=final]")!;

  let shownTime = "";
  let shownPhase = "";

  function update(round: Round, score: number) {
    const text = formatClock(round.secondsShown());
    if (text !== shownTime) {
      shownTime = text;
      time.textContent = text;
    }
    const phase = round.phase();
    // Pulse during the last 10 seconds.
    clock.classList.toggle("urgent", phase === "running" && round.secondsShown() <= 10);
    if (phase === shownPhase) return;
    shownPhase = phase;
    clock.dataset.phase = phase;
    sub.textContent = phase === "ready" ? "PRESS ↑ TO START" : phase === "over" ? "TIME UP" : "";
    over.hidden = phase !== "over";
    if (phase === "over") final.textContent = String(score);
  }

  function dispose() {
    clock.remove();
    over.remove();
  }

  return { update, dispose };
}
