import { useState } from "react";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import { STORAGE_KEYS, PHASES, PHASE_LABELS, PHASE_COLORS } from "@/lib/constants";
import PhaseControls from "@/components/admin/PhaseControls";
import MemberList from "@/components/admin/MemberList";
import AddMemberModal from "@/components/admin/AddMemberModal";
import UrlExportPanel from "@/components/admin/UrlExportPanel";

export default function AdminRoomDetail({ roomId, rooms, members, socket, onBack }) {
  const [advancing, setAdvancing] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

  // Find the room from the shared reactive state
  const room = rooms.find(r => r.id === roomId);
  // Filter members from the shared reactive state
  const roomMembers = members.filter(m => m.roomId === roomId);

  const sendPhaseCommand = (targetPhase) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      alert("WebSocket接続が確立されていません。画面を更新してください。");
      return;
    }
    const adminPassword = sessionStorage.getItem(STORAGE_KEYS.ADMIN_AUTH_PASSWORD) || "maid2024";
    setAdvancing(true);

    // Send phase transition payload directly over WebSocket with authorization password
    socket.send(JSON.stringify({
      type: "SET_PHASE",
      roomId,
      phase: targetPhase,
      password: adminPassword
    }));

    // Mimic synchronous UI feedback, the DO will broadcast the official updated state
    setTimeout(() => {
      setAdvancing(false);
    }, 500);
  };

  const handleAdvance = () => {
    if (!room) return;
    const currentIndex = PHASES.indexOf(room.phase);
    if (currentIndex >= PHASES.length - 1) return;
    const nextPhase = PHASES[currentIndex + 1];
    sendPhaseCommand(nextPhase);
  };

  const handleReset = () => {
    if (!confirm("このRoomをWAITINGにリセットしますか？")) return;
    sendPhaseCommand("WAITING");
  };

  const handleDeleteMember = async (memberId) => {
    try {
      await api.guests.delete(memberId);
    } catch (err) {
      console.error("Failed to delete member:", err);
      alert("メンバー削除に失敗しました。");
    }
  };

  if (!room) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400">Roomが見つかりません</p>
        <button onClick={onBack} className="text-pink-400 hover:text-pink-300 text-sm">← 戻る</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950/90 backdrop-blur-md border-b border-gray-900 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button onClick={onBack} className="p-2 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-900">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-bold text-lg truncate">{room.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold text-white ${PHASE_COLORS[room.phase]}`}>
                {PHASE_LABELS[room.phase]}
              </span>
              <span className="text-gray-600 text-xs">{roomMembers.length}名</span>
            </div>
          </div>
          <button onClick={() => window.location.reload()} className="p-2 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-900">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Phase controls */}
        <PhaseControls
          room={room}
          onAdvance={handleAdvance}
          onReset={handleReset}
          loading={advancing}
        />

        {/* Members */}
        <div className="flex items-center justify-between">
          <div />
          <button
            onClick={() => setShowAddMember(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-xl text-sm font-semibold transition-all"
          >
            <Plus className="w-4 h-4" />
            メンバー追加
          </button>
        </div>

        <MemberList members={roomMembers} onRefresh={() => {}} onDeleteMember={handleDeleteMember} />

        {/* URL export */}
        {roomMembers.length > 0 && (
          <UrlExportPanel members={roomMembers} />
        )}
      </div>

      {/* Add member modal */}
      {showAddMember && (
        <AddMemberModal
          room={room}
          onClose={() => setShowAddMember(false)}
          onAdded={() => {}}
        />
      )}
    </div>
  );
}