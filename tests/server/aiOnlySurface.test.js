import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEmptyData } from '../../server/storage.js';

const serverSource = readFileSync(
  fileURLToPath(new URL('../../server.js', import.meta.url)),
  'utf8',
);
const aiRoutesSource = readFileSync(
  fileURLToPath(new URL('../../server/aiRoutes.js', import.meta.url)),
  'utf8',
);

describe('AI-only server surface', () => {
  it('creates only AI, account, and points storage for new installations', () => {
    expect(createEmptyData()).toEqual({
      aiSessions: {},
      videoJobs: {},
      mediaRequests: {},
      authUsers: {},
      authSessions: {},
      redeemCodes: {},
      pointReservations: {},
      pointTransactions: [],
    });
  });

  it('does not initialize Socket.IO or register realtime social events', () => {
    expect(serverSource).not.toMatch(/from ['"]socket\.io['"]/u);
    expect(serverSource).not.toMatch(/new Server\s*\(/u);
    expect(serverSource).not.toMatch(/['"](?:auth:join|friends:updated|message:new|call:[^'"]+|webrtc:[^'"]+)['"]/u);
  });

  it('does not register account, friend, announcement, or WebRTC HTTP routes', () => {
    const removedRoutes = [
      '/api/announcement',
      '/api/register',
      '/api/login',
      '/api/profile',
      '/api/add-friend',
      '/api/friends/',
      '/api/friend-chat/',
      '/api/friend-message',
      '/api/video-call-request',
      '/api/video-call-requests/',
      '/api/video-call-answer',
      '/api/video-call-offer',
      '/api/video-call-answer-sdp',
      '/api/video-call-candidate',
      '/api/video-call-status/',
      '/api/video-call-end',
    ];

    for (const route of removedRoutes) {
      expect(serverSource, `removed route still registered: ${route}`).not.toContain(route);
    }
  });

  it('retains the AI, upload, health, media, and static delivery entry points', () => {
    expect(serverSource).toContain('registerAiRoutes(app');
    expect(serverSource).toContain('registerUploadEndpoint(app');
    expect(serverSource).toContain("app.set('trust proxy', 'loopback')");
    expect(serverSource).toContain("app.get('/api/health'");
    expect(serverSource).toContain('registerStaticResourceRoutes(app');
    expect(serverSource).toContain('registerSpaFallback(app');
    expect(aiRoutesSource).toContain("app.post('/api/voice/transcribe'");
    expect(serverSource).toContain('createAudioFileStore');
    expect(serverSource).toContain('createVideoFileStore');
  });
});
