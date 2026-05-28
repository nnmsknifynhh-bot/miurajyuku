import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../theme/app_theme.dart';
import '../../providers/app_provider.dart';
import '../../models/app_models.dart';
import '../../widgets/common_widgets.dart';

class MessageTab extends StatefulWidget {
  const MessageTab({super.key});

  @override
  State<MessageTab> createState() => _MessageTabState();
}

class _MessageTabState extends State<MessageTab> with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final user = provider.currentUser!;
    final unreadReplies = provider.getAdminReplies('student', user.id).where((r) => !r.isRead).length;
    final announcements = provider.getAnnouncementsForUser(user.id, 'student');
    final unreadAnnounce = announcements.where((a) => !a.isReadBy(user.id)).length;

    return Column(
      children: [
        // タブバー
        Container(
          color: AppColors.navyDark,
          child: TabBar(
            controller: _tabCtrl,
            indicatorColor: AppColors.yellow,
            labelColor: AppColors.yellow,
            unselectedLabelColor: AppColors.silverDim,
            labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            tabs: [
              Tab(
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Text('先生への連絡'),
                  if (unreadReplies > 0) ...[
                    const SizedBox(width: 4),
                    _Badge(count: unreadReplies, color: AppColors.danger),
                  ],
                ]),
              ),
              Tab(
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Text('お知らせ'),
                  if (unreadAnnounce > 0) ...[
                    const SizedBox(width: 4),
                    _Badge(count: unreadAnnounce, color: AppColors.info),
                  ],
                ]),
              ),
            ],
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabCtrl,
            children: [
              _ChatTab(userId: user.id),
              _AnnouncementHistoryTab(userId: user.id, role: 'student'),
            ],
          ),
        ),
      ],
    );
  }
}

// ── バッジ ──
class _Badge extends StatelessWidget {
  final int count;
  final Color color;
  const _Badge({required this.count, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(8)),
      child: Text('$count', style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800)),
    );
  }
}

// ============================================================
// チャットタブ（管理者への連絡）
// ============================================================
class _ChatTab extends StatefulWidget {
  final String userId;
  const _ChatTab({required this.userId});

  @override
  State<_ChatTab> createState() => _ChatTabState();
}

class _ChatTabState extends State<_ChatTab> {
  final _textController = TextEditingController();
  final _scrollController = ScrollController();
  bool _sending = false;

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _send() async {
    final provider = context.read<AppProvider>();
    final user = provider.currentUser!;
    final text = _textController.text.trim();
    if (text.isEmpty) return;

    setState(() => _sending = true);
    await Future.delayed(const Duration(milliseconds: 300));

    provider.sendMessage(StudentMessage(
      id: 'msg_${DateTime.now().millisecondsSinceEpoch}',
      fromStudentId: user.id,
      fromName: user.name,
      text: text,
      createdAt: DateTime.now(),
    ));

    _textController.clear();
    setState(() => _sending = false);
    provider.markAdminReplyRead('student', user.id);

    Future.delayed(const Duration(milliseconds: 200), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('管理者に送信しました！'),
          backgroundColor: AppColors.success,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final user = provider.currentUser!;
    final myMessages = provider.getMessagesFromStudent(user.id);
    final adminReplies = provider.getAdminReplies('student', user.id);
    final unreadReplies = adminReplies.where((r) => !r.isRead).length;

    final allItems = [
      ...myMessages.map((m) => _MsgItem(isMe: true, text: m.text ?? '', time: m.createdAt)),
      ...adminReplies.map((r) => _MsgItem(isMe: false, text: r.text, time: r.createdAt, imageUrl: r.imageUrl)),
    ]..sort((a, b) => a.time.compareTo(b.time));

    return Column(
      children: [
        // ヘッダー
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AppColors.navyMedium, AppColors.navyDark],
              begin: Alignment.topLeft, end: Alignment.bottomRight,
            ),
          ),
          child: Row(children: [
            Container(
              width: 42, height: 42,
              decoration: BoxDecoration(color: AppColors.info.withValues(alpha: 0.15), shape: BoxShape.circle,
                  border: Border.all(color: AppColors.info.withValues(alpha: 0.4))),
              child: const Icon(Icons.admin_panel_settings, color: AppColors.info, size: 22),
            ),
            const SizedBox(width: 12),
            const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('管理者', style: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 15)),
              Text('三浦塾', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
            ]),
            const Spacer(),
            if (unreadReplies > 0)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: AppColors.danger, borderRadius: BorderRadius.circular(12)),
                child: Text('返信 $unreadReplies件', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
              ),
          ]),
        ),

        // チャット一覧
        Expanded(
          child: allItems.isEmpty
              ? const Center(
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(Icons.chat_bubble_outline, color: AppColors.silverDim, size: 48),
                    SizedBox(height: 12),
                    Text('管理者に連絡してみましょう', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
                  ]),
                )
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  itemCount: allItems.length,
                  itemBuilder: (_, i) => _StudentChatBubble(item: allItems[i]),
                ),
        ),

        // 入力エリア
        Container(
          padding: EdgeInsets.fromLTRB(12, 10, 12, MediaQuery.of(context).viewInsets.bottom + 10),
          decoration: BoxDecoration(
            color: AppColors.navyDark,
            border: Border(top: BorderSide(color: AppColors.cardBorder, width: 0.5)),
          ),
          child: Row(children: [
            GestureDetector(
              onTap: () => ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('写真添付は近日対応予定'), behavior: SnackBarBehavior.floating),
              ),
              child: Container(
                width: 40, height: 40,
                decoration: BoxDecoration(color: AppColors.navyCard, shape: BoxShape.circle,
                    border: Border.all(color: AppColors.cardBorder)),
                child: const Icon(Icons.photo_camera_outlined, color: AppColors.silverDim, size: 18),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _textController,
                maxLines: 4, minLines: 1,
                decoration: InputDecoration(
                  hintText: '管理者へのメッセージを入力...',
                  hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 13),
                  filled: true, fillColor: AppColors.navyCard,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: BorderSide.none),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                ),
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: _sending ? null : _send,
              child: Container(
                width: 44, height: 44,
                decoration: BoxDecoration(
                  color: _sending ? AppColors.silverDim : AppColors.info,
                  shape: BoxShape.circle,
                ),
                child: _sending
                    ? const Padding(padding: EdgeInsets.all(12),
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.send_rounded, color: Colors.white, size: 20),
              ),
            ),
          ]),
        ),
      ],
    );
  }
}

// ============================================================
// お知らせ履歴タブ（生徒・共用）
// ============================================================
class _AnnouncementHistoryTab extends StatelessWidget {
  final String userId;
  final String role;
  const _AnnouncementHistoryTab({required this.userId, required this.role});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final announcements = provider.getAnnouncementsForUser(userId, role);

    if (announcements.isEmpty) {
      return const Center(
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(Icons.campaign_outlined, color: AppColors.silverDim, size: 56),
          SizedBox(height: 12),
          Text('お知らせはまだありません', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        ]),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      itemCount: announcements.length,
      itemBuilder: (_, i) {
        final a = announcements[i];
        final isRead = a.isReadBy(userId);
        return _AnnouncementCard(
          announcement: a,
          userId: userId,
          isRead: isRead,
        );
      },
    );
  }
}

class _AnnouncementCard extends StatelessWidget {
  final Announcement announcement;
  final String userId;
  final bool isRead;
  const _AnnouncementCard({required this.announcement, required this.userId, required this.isRead});

  @override
  Widget build(BuildContext context) {
    final a = announcement;
    final provider = context.read<AppProvider>();
    final timeStr = '${a.createdAt.month}/${a.createdAt.day} '
        '${a.createdAt.hour.toString().padLeft(2, '0')}:${a.createdAt.minute.toString().padLeft(2, '0')}';

    return GlowCard(
      margin: const EdgeInsets.only(bottom: 12),
      glowColor: isRead ? AppColors.cardBorder : AppColors.info,
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // ヘッダー行
        Row(children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: (isRead ? AppColors.silverDim : AppColors.info).withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.campaign_rounded,
                color: isRead ? AppColors.silverDim : AppColors.info, size: 16),
          ),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(a.title, style: TextStyle(
              color: isRead ? AppColors.textSecondary : AppColors.textPrimary,
              fontSize: 14, fontWeight: FontWeight.w700,
            )),
            Text(timeStr, style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
          ])),
          if (!isRead)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: AppColors.info, borderRadius: BorderRadius.circular(8)),
              child: const Text('NEW', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800)),
            )
          else
            const Icon(Icons.check_circle, color: AppColors.success, size: 16),
        ]),

        const SizedBox(height: 10),

        // 本文
        Text(a.body, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5)),

        // 画像（バイナリ優先、なければURL）
        if (a.imageBytes != null) ...[
          const SizedBox(height: 10),
          GestureDetector(
            onTap: () => _showImageDialogBytes(context, Uint8List.fromList(a.imageBytes!)),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.memory(
                Uint8List.fromList(a.imageBytes!),
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
          ),
          const SizedBox(height: 4),
          const Text('タップで拡大', style: TextStyle(color: AppColors.silverDim, fontSize: 10)),
        ] else if (a.imageUrl != null) ...[
          const SizedBox(height: 10),
          GestureDetector(
            onTap: () => _showImageDialogUrl(context, a.imageUrl!),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.network(
                a.imageUrl!,
                width: double.infinity,
                fit: BoxFit.cover,
                loadingBuilder: (_, child, progress) => progress == null
                    ? child
                    : Container(
                        height: 120,
                        color: AppColors.navyCard,
                        child: const Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.info)),
                      ),
                errorBuilder: (_, __, ___) => Container(
                  height: 60,
                  decoration: BoxDecoration(
                    color: AppColors.navyCard,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.cardBorder),
                  ),
                  child: const Center(child: Icon(Icons.broken_image, color: AppColors.silverDim, size: 24)),
                ),
              ),
            ),
          ),
          const SizedBox(height: 4),
          const Text('タップで拡大', style: TextStyle(color: AppColors.silverDim, fontSize: 10)),
        ],

        // 既読ボタン
        if (!isRead) ...[
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => provider.markAnnouncementRead(a.id, userId),
              icon: const Icon(Icons.check_circle_outline, size: 16, color: AppColors.info),
              label: const Text('既読にする', style: TextStyle(color: AppColors.info, fontSize: 13)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.info),
                minimumSize: const Size(0, 38),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ],
      ]),
    );
  }

  void _showImageDialogBytes(BuildContext context, Uint8List bytes) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(children: [
          InteractiveViewer(child: Image.memory(bytes, fit: BoxFit.contain)),
          Positioned(
            top: 8, right: 8,
            child: GestureDetector(
              onTap: () => Navigator.pop(ctx),
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                child: const Icon(Icons.close, color: Colors.white, size: 20),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  void _showImageDialogUrl(BuildContext context, String url) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(children: [
          InteractiveViewer(child: Image.network(url, fit: BoxFit.contain)),
          Positioned(
            top: 8, right: 8,
            child: GestureDetector(
              onTap: () => Navigator.pop(ctx),
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                child: const Icon(Icons.close, color: Colors.white, size: 20),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

// ── チャットデータ ──
class _MsgItem {
  final bool isMe;
  final String text;
  final DateTime time;
  final String? imageUrl;
  _MsgItem({required this.isMe, required this.text, required this.time, this.imageUrl});
}

// ── チャットバブル（生徒視点） ──
class _StudentChatBubble extends StatelessWidget {
  final _MsgItem item;
  const _StudentChatBubble({required this.item});

  @override
  Widget build(BuildContext context) {
    final timeStr = _fmt(item.time);

    if (item.isMe) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            Text(timeStr, style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
            const SizedBox(width: 6),
            const Text('あなた', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 4),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            const SizedBox(width: 60),
            Flexible(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF1E6FC5), Color(0xFF1A5BA8)],
                    begin: Alignment.topLeft, end: Alignment.bottomRight,
                  ),
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(14), topRight: Radius.circular(4),
                    bottomLeft: Radius.circular(14), bottomRight: Radius.circular(14),
                  ),
                  boxShadow: [BoxShadow(color: AppColors.info.withValues(alpha: 0.2), blurRadius: 6, offset: const Offset(0, 2))],
                ),
                child: Text(item.text, style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.5)),
              ),
            ),
          ]),
          const SizedBox(height: 2),
          const Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            Icon(Icons.done_all, color: AppColors.success, size: 12),
            SizedBox(width: 3),
            Text('送信済', style: TextStyle(color: AppColors.success, fontSize: 10)),
          ]),
        ]),
      );
    } else {
      return Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              width: 28, height: 28,
              decoration: BoxDecoration(color: AppColors.yellow.withValues(alpha: 0.12), shape: BoxShape.circle),
              child: const Icon(Icons.admin_panel_settings, color: AppColors.yellow, size: 16),
            ),
            const SizedBox(width: 6),
            const Text('管理者', style: TextStyle(color: AppColors.yellow, fontSize: 11, fontWeight: FontWeight.w700)),
            const SizedBox(width: 6),
            Text(timeStr, style: const TextStyle(color: AppColors.silverDim, fontSize: 10)),
          ]),
          const SizedBox(height: 4),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SizedBox(width: 34),
            Flexible(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.navyCard,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(4), topRight: Radius.circular(14),
                      bottomLeft: Radius.circular(14), bottomRight: Radius.circular(14),
                    ),
                    border: Border.all(color: AppColors.yellow.withValues(alpha: 0.4)),
                  ),
                  child: Text(item.text, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, height: 1.5)),
                ),
                if (item.imageUrl != null) ...[
                  const SizedBox(height: 6),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.network(item.imageUrl!, width: 200, fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const Icon(Icons.broken_image, color: AppColors.silverDim)),
                  ),
                ],
              ]),
            ),
            const SizedBox(width: 60),
          ]),
        ]),
      );
    }
  }

  String _fmt(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'たった今';
    if (diff.inMinutes < 60) return '${diff.inMinutes}分前';
    if (diff.inHours < 24) return '${diff.inHours}時間前';
    return '${dt.month}/${dt.day} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }
}
