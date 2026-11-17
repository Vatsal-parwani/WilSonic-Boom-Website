const APP_ID = 'wilsonic-boom-ftc-33001-v1';

export function createPvpClient() {
  let lobbyRoom = null;
  let matchRoom = null;
  let seekInterval = 0;
  let syncInterval = 0;
  let aborted = false;

  let stateAct = null;
  let shootAct = null;
  let hitAct = null;
  let koAct = null;

  function leave() {
    aborted = true;
    if (seekInterval) { clearInterval(seekInterval); seekInterval = 0; }
    if (syncInterval) { clearInterval(syncInterval); syncInterval = 0; }
    if (lobbyRoom) { try { lobbyRoom.leave(); } catch {} lobbyRoom = null; }
    if (matchRoom) { try { matchRoom.leave(); } catch {} matchRoom = null; }
    stateAct = null;
    shootAct = null;
    hitAct = null;
    koAct = null;
  }

  async function startSearch(cb) {
    leave();
    aborted = false;

    try {
      const { joinRoom } = await import('trystero');
      if (aborted) return;

      lobbyRoom = joinRoom({ appId: APP_ID }, 'wilsonic-1v1-lobby');
      lobbyRoom.onError((err) => console.warn('[1v1 lobby]', err));

      const self = await lobbyRoom.getSelf();
      if (aborted) return;
      const myPeerId = self.peerId;

      const seekAct = lobbyRoom.makeAction('seek');
      const inviteAct = lobbyRoom.makeAction('invite');
      const acceptAct = lobbyRoom.makeAction('accept');

      let matched = false;
      cb.onStatus('Searching for another player online…');

      const enterMatch = (matchId, oppPeerId, amHost) => {
        if (seekInterval) { clearInterval(seekInterval); seekInterval = 0; }
        if (lobbyRoom) { try { lobbyRoom.leave(); } catch {} lobbyRoom = null; }

        matchRoom = joinRoom({ appId: APP_ID }, matchId);
        matchRoom.onError((err) => console.warn('[1v1 match]', err));

        stateAct = matchRoom.makeAction('state');
        shootAct = matchRoom.makeAction('shoot');
        hitAct = matchRoom.makeAction('hit');
        koAct = matchRoom.makeAction('ko');

        stateAct.onMessage((data) => cb.onOppState(data));
        shootAct.onMessage((data) => cb.onOppShoot(data));
        hitAct.onMessage((data) => cb.onHit(data));
        koAct.onMessage(() => cb.onKo());

        matchRoom.onPeerLeave(({ peerId }) => {
          if (peerId === oppPeerId) cb.onPeerLeft();
        });

        syncInterval = setInterval(() => {
          if (stateAct) {
            const payload = cb.getStatePayload();
            if (payload) stateAct.send(payload).catch(() => {});
          }
        }, 50);

        cb.onMatchStart({ amHost, peerId: oppPeerId });
      };

      const tryPair = (peerId) => {
        if (matched || aborted || !peerId || peerId === myPeerId) return;
        if (myPeerId < peerId) {
          const matchId = `wilsonic-m-${myPeerId.slice(0, 6)}-${peerId.slice(0, 6)}`;
          inviteAct.send({ matchId }, { target: peerId }).catch(() => {});
        }
      };

      lobbyRoom.onPeerJoin(({ peerId }) => tryPair(peerId));
      seekAct.onMessage((_data, { peerId }) => tryPair(peerId));

      inviteAct.onMessage(async (data, { peerId }) => {
        if (matched || aborted || !data?.matchId) return;
        matched = true;
        try { await acceptAct.send({ matchId: data.matchId }, { target: peerId }); } catch {}
        enterMatch(data.matchId, peerId, false);
      });

      acceptAct.onMessage((data, { peerId }) => {
        if (matched || aborted || !data?.matchId) return;
        matched = true;
        enterMatch(data.matchId, peerId, true);
      });

      seekAct.send({ t: Date.now() }).catch(() => {});
      seekInterval = setInterval(() => {
        if (!matched && !aborted) seekAct.send({ t: Date.now() }).catch(() => {});
      }, 1200);
    } catch (err) {
      console.error('[1v1 error]', err);
      cb.onError(err);
    }
  }

  return {
    startSearch,
    leave,
    sendShoot: (p) => { if (shootAct) shootAct.send(p).catch(() => {}); },
    sendHit: (p) => { if (hitAct) hitAct.send(p).catch(() => {}); },
    sendKo: (p) => { if (koAct) koAct.send(p).catch(() => {}); },
  };
}
