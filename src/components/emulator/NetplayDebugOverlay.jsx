import React, { useState, useEffect } from 'react';
import { Activity, Wifi, RefreshCw, Cpu, Sliders, ShieldCheck, AlertTriangle, Eye, EyeOff } from 'lucide-react';

export const NetplayDebugOverlay = ({
  stats = {},
  networkStats = {},
  networkSimulator = null,
  onSimulatorChange = () => {},
  visible = true,
  onClose = () => {}
}) => {
  const [activeTab, setActiveTab] = useState('telemetry'); // 'telemetry' | 'simulator'
  const [simLatency, setSimLatency] = useState(networkSimulator?.latency || 0);
  const [simJitter, setSimJitter] = useState(networkSimulator?.jitter || 0);
  const [simLoss, setSimLoss] = useState(networkSimulator?.packetLoss || 0);

  const handleSimChange = (lat, jit, loss) => {
    setSimLatency(lat);
    setSimJitter(jit);
    setSimLoss(loss);
    onSimulatorChange({ latency: lat, jitter: jit, packetLoss: loss });
  };

  const handleResetSim = () => {
    handleSimChange(0, 0, 0);
  };

  if (!visible) return null;

  const ping = networkStats.ping ?? stats.ping ?? 0;
  const jitter = networkStats.jitter ?? stats.jitter ?? 0;
  const packetLoss = networkStats.packetLoss ?? stats.packetLoss ?? 0;
  const rollbacks = stats.totalRollbacks ?? 0;
  const lastDepth = stats.lastRollbackDistance ?? 0;
  const mispreds = stats.mispredictions ?? 0;
  const currentFrame = stats.totalFrames ?? stats.currentFrame ?? 0;
  const advantage = stats.frameAdvantage ?? 0;
  const fps = stats.fps ?? 60;
  const isHealthy = packetLoss < 2 && ping < 100 && (stats.syncRatio ?? 1) > 0.99;

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: 320,
        maxHeight: '90vh',
        overflowY: 'auto',
        backgroundColor: 'rgba(11, 15, 25, 0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(0, 240, 255, 0.35)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8), 0 0 16px rgba(0, 240, 255, 0.15)',
        borderRadius: 8,
        padding: 14,
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#e2e8f0',
        zIndex: 99999,
        pointerEvents: 'auto',
        userSelect: 'none'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#00f0ff', fontWeight: 'bold', fontSize: 13 }}>
          <Activity size={16} />
          <span>GGPO ROLLBACK HUD (F8)</span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}
          title="Fermer (F8)"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button
          onClick={() => setActiveTab('telemetry')}
          style={{
            flex: 1,
            padding: '4px 8px',
            borderRadius: 4,
            border: 'none',
            background: activeTab === 'telemetry' ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255,255,255,0.05)',
            color: activeTab === 'telemetry' ? '#00f0ff' : '#94a3b8',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 11
          }}
        >
          TÉLÉMÉTRIE
        </button>
        <button
          onClick={() => setActiveTab('simulator')}
          style={{
            flex: 1,
            padding: '4px 8px',
            borderRadius: 4,
            border: 'none',
            background: activeTab === 'simulator' ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255,255,255,0.05)',
            color: activeTab === 'simulator' ? '#fbbf24' : '#94a3b8',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 11
          }}
        >
          SIMULATEUR
        </button>
      </div>

      {/* Telemetry View */}
      {activeTab === 'telemetry' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Status Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            borderRadius: 4,
            background: isHealthy ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
            border: `1px solid ${isHealthy ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`,
            color: isHealthy ? '#4ade80' : '#f87171',
            fontWeight: 'bold'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {isHealthy ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
              <span>{isHealthy ? 'DÉTERMINISME PARFAIT' : 'ATTENTION DIVERGENCE'}</span>
            </div>
            <span>{fps.toFixed(0)} FPS</span>
          </div>

          {/* Network Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 4 }}>
            <div>
              <div style={{ color: '#94a3b8', fontSize: 10 }}>PING (RTT)</div>
              <div style={{ color: ping < 60 ? '#4ade80' : (ping < 120 ? '#fbbf24' : '#f87171'), fontWeight: 'bold' }}>
                {ping.toFixed(0)} ms
              </div>
            </div>
            <div>
              <div style={{ color: '#94a3b8', fontSize: 10 }}>JITTER</div>
              <div style={{ color: jitter < 15 ? '#4ade80' : '#fbbf24', fontWeight: 'bold' }}>
                {jitter.toFixed(1)} ms
              </div>
            </div>
            <div>
              <div style={{ color: '#94a3b8', fontSize: 10 }}>PERTE</div>
              <div style={{ color: packetLoss === 0 ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                {packetLoss.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Rollback Stats */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Total Rollbacks :</span>
              <span style={{ color: '#00f0ff', fontWeight: 'bold' }}>{rollbacks}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Dernière profondeur :</span>
              <span style={{ color: lastDepth > 4 ? '#fbbf24' : '#4ade80', fontWeight: 'bold' }}>{lastDepth} frame(s)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Erreurs prédiction :</span>
              <span style={{ color: mispreds > 0 ? '#fbbf24' : '#4ade80', fontWeight: 'bold' }}>{mispreds}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Avance/Retard :</span>
              <span style={{ color: Math.abs(advantage) > 3 ? '#fbbf24' : '#4ade80', fontWeight: 'bold' }}>
                {advantage > 0 ? `+${advantage}` : advantage} frames
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Frame courante :</span>
              <span style={{ color: '#e2e8f0' }}>#{currentFrame}</span>
            </div>
          </div>
        </div>
      )}

      {/* Simulator View */}
      {activeTab === 'simulator' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#fbbf24', background: 'rgba(251, 191, 36, 0.1)', padding: 6, borderRadius: 4, border: '1px solid rgba(251, 191, 36, 0.2)' }}>
            Simulez des conditions dégradées pour observer la réactivité du rollback sans interruption.
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Latence artificielle :</span>
              <span style={{ color: '#00f0ff', fontWeight: 'bold' }}>{simLatency} ms</span>
            </div>
            <input
              type="range"
              min="0"
              max="300"
              step="10"
              value={simLatency}
              onChange={(e) => handleSimChange(parseInt(e.target.value, 10), simJitter, simLoss)}
              style={{ width: '100%', accentColor: '#00f0ff' }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Jitter artificiel :</span>
              <span style={{ color: '#00f0ff', fontWeight: 'bold' }}>±{simJitter} ms</span>
            </div>
            <input
              type="range"
              min="0"
              max="50"
              step="2"
              value={simJitter}
              onChange={(e) => handleSimChange(simLatency, parseInt(e.target.value, 10), simLoss)}
              style={{ width: '100%', accentColor: '#00f0ff' }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Perte de paquets UDP :</span>
              <span style={{ color: '#00f0ff', fontWeight: 'bold' }}>{simLoss}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="15"
              step="1"
              value={simLoss}
              onChange={(e) => handleSimChange(simLatency, simJitter, parseInt(e.target.value, 10))}
              style={{ width: '100%', accentColor: '#00f0ff' }}
            />
          </div>

          <button
            onClick={handleResetSim}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.05)',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 11
            }}
          >
            Réinitialiser Réseau Pur (0 ms / 0%)
          </button>
        </div>
      )}
    </div>
  );
};

export default NetplayDebugOverlay;
