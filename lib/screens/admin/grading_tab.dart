// ============================================================
// 管理者：宿題 採点・返却タブ
// 生徒が提出 → AIが自動採点 → ここに届く → 「返却」で生徒に戻る
// ============================================================
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../../services/grading_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/grade_result_view.dart';

enum _Filter { pending, returned, all }

class GradingTab extends StatefulWidget {
  final ValueChanged<int>? onPendingChanged;
  const GradingTab({super.key, this.onPendingChanged});

  @override
  State<GradingTab> createState() => _GradingTabState();
}

class _GradingTabState extends State<GradingTab> {
  final _svc = GradingService.instance;
  final _tokenCtrl = TextEditingController();

  bool _ready = false;
  List<HomeworkSubmission>? _all;
  String? _error;
  _Filter _filter = _Filter.pending;
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    _svc.ensureLoaded().then((_) {
      if (!mounted) return;
      setState(() => _ready = true);
      if (_svc.isConfigured && _svc.hasAdminToken) _reload();
    });
  }

  @override
  void dispose() {
    _tokenCtrl.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() => _error = null);
    try {
      final list = await _svc.listAll();
      if (!mounted) return;
      setState(() => _all = list);
      widget.onPendingChanged?.call(list.where((s) => s.isGraded || s.isError).length);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _saveToken() async {
    final t = _tokenCtrl.text.trim();
    if (t.isEmpty) return;
    try {
      await _svc.setAdminToken(t);
      _tokenCtrl.clear();
      if (mounted) setState(() {});
      await _reload();
    } catch (e) {
      _snack('$e', AppColors.danger);
    }
  }

  Future<void> _quickReturn(HomeworkSubmission s) async {
    setState(() => _busy.add(s.id));
    try {
      await _svc.returnToStudent(s.id, s.items, s.teacherComment);
      _snack('${s.studentLabel} さんに返却しました', AppColors.success);
      await _reload();
    } catch (e) {
      _snack('$e', AppColors.danger);
    } finally {
      if (mounted) setState(() => _busy.remove(s.id));
    }
  }

  Future<void> _openDetail(HomeworkSubmission s) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _GradingDetailPage(submission: s)),
    );
    if (changed == true) await _reload();
  }

  void _snack(String msg, Color color) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: color,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ));
  }

  List<HomeworkSubmission> get _filtered {
    final list = _all ?? [];
    switch (_filter) {
      case _Filter.pending:
        return list.where((s) => !s.isReturned).toList();
      case _Filter.returned:
        return list.where((s) => s.isReturned).toList();
      case _Filter.all:
        return list;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) return const AppLoader();
    if (!_svc.isConfigured) {
      return const _InfoMessage(
        icon: Icons.cloud_off,
        text: '採点サーバーが未設定です。\n'
            'gas/README.md の手順で Google Apps Script を設定し、\n'
            'web/grading_config.json に URL を入れてください。',
      );
    }
    if (!_svc.hasAdminToken) return _buildTokenForm();

    final pendingCount = (_all ?? []).where((s) => !s.isReturned).length;
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
        child: Row(children: [
          const Icon(Icons.fact_check_rounded, color: AppColors.yellow, size: 20),
          const SizedBox(width: 8),
          const Expanded(
            child: Text('宿題 採点・返却',
                style: TextStyle(color: AppColors.textPrimary, fontSize: 17, fontWeight: FontWeight.w700)),
          ),
          IconButton(
              tooltip: '更新', onPressed: _reload, icon: const Icon(Icons.refresh, color: AppColors.silverDim)),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert, color: AppColors.silverDim),
            color: AppColors.navyCard,
            onSelected: (v) async {
              if (v == 'logout') {
                await _svc.clearAdminToken();
                if (mounted) setState(() => _all = null);
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'logout', child: Text('先生用合言葉を再入力')),
            ],
          ),
        ]),
      ),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(children: [
          _filterChip(_Filter.pending, '未返却 $pendingCount'),
          const SizedBox(width: 8),
          _filterChip(_Filter.returned, '返却済み'),
          const SizedBox(width: 8),
          _filterChip(_Filter.all, 'すべて'),
        ]),
      ),
      const SizedBox(height: 8),
      Expanded(
        child: RefreshIndicator(
          color: AppColors.yellow,
          onRefresh: _reload,
          child: _buildList(),
        ),
      ),
    ]);
  }

  Widget _buildList() {
    if (_error != null) {
      return ListView(padding: const EdgeInsets.all(16), children: [
        Text(_error!, style: const TextStyle(color: AppColors.danger)),
      ]);
    }
    if (_all == null) return const AppLoader();
    final list = _filtered;
    if (list.isEmpty) {
      return ListView(children: const [
        SizedBox(height: 80),
        EmptyState(message: '該当する提出はありません', icon: Icons.inbox_outlined),
      ]);
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      itemCount: list.length,
      itemBuilder: (_, i) {
        final s = list[i];
        return _AdminSubmissionCard(
          submission: s,
          busy: _busy.contains(s.id),
          onTap: () => _openDetail(s),
          onReturn: s.isGraded ? () => _quickReturn(s) : null,
        );
      },
    );
  }

  Widget _filterChip(_Filter f, String label) {
    final selected = _filter == f;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => setState(() => _filter = f),
      selectedColor: AppColors.yellow.withValues(alpha: 0.2),
      backgroundColor: AppColors.card,
      side: BorderSide(color: selected ? AppColors.yellow : AppColors.cardBorder),
      labelStyle: TextStyle(
          color: selected ? AppColors.yellow : AppColors.textSecondary,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
          fontSize: 12),
      showCheckmark: false,
    );
  }

  Widget _buildTokenForm() {
    return ListView(padding: const EdgeInsets.all(24), children: [
      const SizedBox(height: 24),
      const Icon(Icons.lock_outline, color: AppColors.yellow, size: 48),
      const SizedBox(height: 16),
      const Text('先生用の合言葉を入力してください',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      const Text('Code.gs の ADMIN_TOKEN に設定したものです。\nこの端末に保存されるので、入力は最初の1回だけです。',
          textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
      const SizedBox(height: 20),
      TextField(
        controller: _tokenCtrl,
        obscureText: true,
        style: const TextStyle(color: AppColors.textPrimary),
        decoration: const InputDecoration(
          labelText: '先生用の合言葉',
          prefixIcon: Icon(Icons.key, color: AppColors.silverDim),
        ),
        onSubmitted: (_) => _saveToken(),
      ),
      const SizedBox(height: 16),
      ElevatedButton(
        onPressed: _saveToken,
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.yellow,
          foregroundColor: AppColors.navyDark,
          minimumSize: const Size(double.infinity, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        child: const Text('確認して保存', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
    ]);
  }
}

class _InfoMessage extends StatelessWidget {
  final IconData icon;
  final String text;
  const _InfoMessage({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, color: AppColors.silverDim, size: 48),
            const SizedBox(height: 12),
            Text(text,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.6)),
          ]),
        ),
      );
}

class _AdminSubmissionCard extends StatelessWidget {
  final HomeworkSubmission submission;
  final bool busy;
  final VoidCallback onTap;
  final VoidCallback? onReturn;
  const _AdminSubmissionCard(
      {required this.submission, required this.busy, required this.onTap, this.onReturn});

  @override
  Widget build(BuildContext context) {
    final s = submission;
    final date = s.submittedAt == null ? '' : DateFormat('M/d(E) HH:mm', 'ja').format(s.submittedAt!);
    final counts = GradeCounts.of(s.items);
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: onTap,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child: Text(s.studentLabel,
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700)),
          ),
          AppChip(label: s.status, color: statusColor(s.status)),
        ]),
        const SizedBox(height: 4),
        Text([if (s.subject.isNotEmpty) s.subject, s.workbook, 'p.${s.pages}'].join('  '),
            style: const TextStyle(color: AppColors.silver, fontSize: 13)),
        Text('$date 提出・写真${s.photoCount}枚',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
        if (s.isError)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(s.error,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.danger, fontSize: 11)),
          ),
        if (s.items.isNotEmpty && !s.isError) ...[
          const SizedBox(height: 10),
          Row(children: [
            Text('${counts.ok}',
                style: const TextStyle(color: AppColors.yellow, fontSize: 22, fontWeight: FontWeight.w900)),
            Text(' / ${counts.graded} 問正解',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            if (counts.hold > 0) ...[
              const SizedBox(width: 8),
              AppChip(label: '保留 ${counts.hold}', color: holdColor),
            ],
            const Spacer(),
            // 保留が残っているものは、開いて確認してから返却する
            if (onReturn != null && counts.hold == 0)
              ElevatedButton.icon(
                onPressed: busy ? null : onReturn,
                icon: busy
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.navyDark))
                    : const Icon(Icons.reply_rounded, size: 18),
                label: const Text('返却', style: TextStyle(fontWeight: FontWeight.w800)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.yellow,
                  foregroundColor: AppColors.navyDark,
                  minimumSize: const Size(96, 40),
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
          ]),
        ],
      ]),
    );
  }
}

/// 1件の採点確認・修正・返却
class _GradingDetailPage extends StatefulWidget {
  final HomeworkSubmission submission;
  const _GradingDetailPage({required this.submission});

  @override
  State<_GradingDetailPage> createState() => _GradingDetailPageState();
}

class _GradingDetailPageState extends State<_GradingDetailPage> {
  final _svc = GradingService.instance;
  late HomeworkSubmission _s;
  late List<GradeItem> _items;
  late TextEditingController _commentCtrl;
  List<Uint8List>? _photos;
  String? _photoError;
  bool _busy = false;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _apply(widget.submission);
    _commentCtrl = TextEditingController(text: _s.teacherComment);
    _svc
        .getImages(_s.id, admin: true)
        .then((p) => mounted ? setState(() => _photos = p) : null)
        .catchError((e) => mounted ? setState(() => _photoError = '$e') : null);
  }

  void _apply(HomeworkSubmission s) {
    _s = s;
    _items = s.items.map((e) => GradeItem.fromJson(e.toJson())).toList();
  }

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  void _toggle(GradeItem it) => setState(it.cycleJudgment);

  Future<void> _run(Future<HomeworkSubmission?> Function() action, String doneMsg,
      {bool close = false}) async {
    setState(() => _busy = true);
    try {
      final updated = await action();
      _changed = true;
      if (!mounted) return;
      if (updated != null) setState(() => _apply(updated));
      _snack(doneMsg, AppColors.success);
      if (close) Navigator.of(context).pop(true);
    } catch (e) {
      _snack('$e', AppColors.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String msg, Color color) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: color,
      behavior: SnackBarBehavior.floating,
    ));
  }

  Future<void> _confirmDelete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.navyCard,
        title: const Text('この提出を削除しますか？', style: TextStyle(color: AppColors.textPrimary, fontSize: 16)),
        content: const Text('写真もゴミ箱に移動します。', style: TextStyle(color: AppColors.textSecondary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('キャンセル')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('削除', style: TextStyle(color: AppColors.danger))),
        ],
      ),
    );
    if (ok == true) {
      await _run(() async {
        await _svc.delete(_s.id);
        return null;
      }, '削除しました', close: true);
    }
  }

  /// AIの文章（LINE報告・苦手分析）を作って表示する
  Future<void> _showGenerated(String title, Future<String> Function() make, {String? existing}) async {
    String? text = existing;
    if (text == null || text.isEmpty) {
      setState(() => _busy = true);
      try {
        // LINE報告は保存済みの採点結果から作るので、先に今の判定を保存する
        await _svc.save(_s.id, _items, _commentCtrl.text.trim());
        _changed = true;
        text = await make();
      } catch (e) {
        _snack('$e', AppColors.danger);
        return;
      } finally {
        if (mounted) setState(() => _busy = false);
      }
    }
    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.navyDark,
      builder: (ctx) => _GeneratedTextSheet(
        title: title,
        text: text!,
        onRegenerate: () async {
          Navigator.pop(ctx);
          await _showGenerated(title, make);
        },
      ),
    );
  }

  Future<void> _lineReport({bool fresh = false}) async {
    if (GradeCounts.of(_items).hold > 0) {
      _snack('保留が残っています。保留の問題は報告に含めずに作成します', holdColor);
    }
    await _showGenerated('保護者向けLINE報告', () => _svc.lineReport(_s.id),
        existing: fresh ? null : _s.lineReport);
  }

  @override
  Widget build(BuildContext context) {
    final counts = GradeCounts.of(_items);
    // 報告は「×・保留」のみ。問題集の掲載順（サーバーでページ順に並べ済み）
    final ngAndHold = _items.where((e) => !e.isOk).toList();
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        appBar: AppBar(
          title: Text(_s.studentLabel),
          actions: [
            PopupMenuButton<String>(
              color: AppColors.navyCard,
              enabled: !_busy,
              onSelected: (v) {
                switch (v) {
                  case 'line':
                    _lineReport();
                    break;
                  case 'analyze':
                    _showGenerated('${_s.studentLabel} の苦手分析', () => _svc.analyzeStudent(_s.studentId));
                    break;
                  case 'regrade':
                    _run(() => _svc.regrade(_s.id), 'AIで採点し直しました');
                    break;
                  case 'delete':
                    _confirmDelete();
                    break;
                }
              },
              itemBuilder: (_) => [
                if (_items.isNotEmpty) const PopupMenuItem(value: 'line', child: Text('保護者LINE報告を作成')),
                const PopupMenuItem(value: 'analyze', child: Text('この生徒の苦手分析')),
                const PopupMenuItem(value: 'regrade', child: Text('AIで採点し直す')),
                const PopupMenuItem(value: 'delete', child: Text('削除', style: TextStyle(color: AppColors.danger))),
              ],
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
          children: [
            Text([if (_s.subject.isNotEmpty) _s.subject, _s.workbook, 'p.${_s.pages}'].join('  '),
                style: const TextStyle(color: AppColors.silver, fontSize: 14, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            if (_items.isNotEmpty) ...[
              ScoreHeader(counts: counts),
              const SizedBox(height: 6),
              const Text('写真の ○ / × / ? をタップすると 判定が変わります（○→×→保留）',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
              const SizedBox(height: 10),
            ],
            MarkedPhotoList(
              photos: _photos,
              error: _photoError,
              items: _items,
              onToggleItem: _busy ? null : _toggle,
            ),
            if (_s.isError) ...[
              CommentBox(
                  title: '採点エラー', text: _s.error, icon: Icons.error_outline, color: AppColors.danger),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _run(() => _svc.regrade(_s.id), 'AIで採点し直しました'),
                icon: const Icon(Icons.refresh),
                label: const Text('AIで採点し直す'),
              ),
              const SizedBox(height: 16),
            ] else if (_s.error.isNotEmpty) ...[
              CommentBox(title: 'AIの確認状況', text: _s.error, icon: Icons.fact_check_outlined, color: AppColors.silver),
              const SizedBox(height: 12),
            ],
            if (_items.isNotEmpty) ...[
              Row(children: [
                const Text('× ・保留', style: TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700)),
                const SizedBox(width: 8),
                Text('（○ ${counts.ok}問は省略・掲載順）',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
              ]),
              const SizedBox(height: 8),
              if (ngAndHold.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text('×・保留の問題はありません 🎉', style: TextStyle(color: AppColors.success)),
                ),
              for (final it in ngAndHold)
                ResultRow(item: it, forTeacher: true, onToggle: _busy ? null : () => _toggle(it)),
              if (_s.overallComment.isNotEmpty) ...[
                const SizedBox(height: 6),
                CommentBox(
                    title: 'AIからのひとこと（生徒にも表示）',
                    text: _s.overallComment,
                    icon: Icons.lightbulb_outline,
                    color: AppColors.info),
              ],
            ],
            const SizedBox(height: 12),
            TextField(
              controller: _commentCtrl,
              maxLines: 3,
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
              decoration: const InputDecoration(
                labelText: '先生からのコメント（任意・生徒に表示）',
                alignLabelWithHint: true,
              ),
            ),
          ],
        ),
        bottomNavigationBar: SafeArea(
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            decoration: const BoxDecoration(
              color: AppColors.navyDark,
              border: Border(top: BorderSide(color: AppColors.cardBorder)),
            ),
            child: Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy || _s.isError
                      ? null
                      : () => _run(() => _svc.save(_s.id, _items, _commentCtrl.text.trim()), '保存しました'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.silver,
                    side: const BorderSide(color: AppColors.silverDim),
                    minimumSize: const Size(0, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('保存のみ'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: ElevatedButton.icon(
                  // 保留が残っている間は返却できない（最終判断は講師）
                  onPressed: _busy || _s.isError || _items.isEmpty || counts.hold > 0
                      ? null
                      : () => _run(
                          () => _svc.returnToStudent(_s.id, _items, _commentCtrl.text.trim()),
                          '${_s.studentName} さんに返却しました',
                          close: true),
                  icon: _busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.navyDark))
                      : const Icon(Icons.reply_rounded),
                  label: Text(
                      counts.hold > 0
                          ? '保留${counts.hold}件を判定して返却'
                          : (_s.isReturned ? '修正して再返却' : '返却する'),
                      style: TextStyle(fontSize: counts.hold > 0 ? 13 : 16, fontWeight: FontWeight.w800)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.yellow,
                    foregroundColor: AppColors.navyDark,
                    disabledBackgroundColor: AppColors.yellow.withValues(alpha: 0.3),
                    disabledForegroundColor: AppColors.navyDark.withValues(alpha: 0.7),
                    minimumSize: const Size(0, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

/// AIが作った文章（LINE報告・苦手分析）を表示してコピーする
class _GeneratedTextSheet extends StatelessWidget {
  final String title;
  final String text;
  final VoidCallback onRegenerate;
  const _GeneratedTextSheet({required this.title, required this.text, required this.onRegenerate});

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (ctx, scroll) => Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
          child: Row(children: [
            Expanded(
              child: Text(title,
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w700)),
            ),
            IconButton(
                tooltip: '閉じる',
                onPressed: () => Navigator.pop(ctx),
                icon: const Icon(Icons.close, color: AppColors.silverDim)),
          ]),
        ),
        Expanded(
          child: ListView(controller: scroll, padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.card,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.cardBorder),
              ),
              child: SelectableText(text,
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, height: 1.7)),
            ),
            const SizedBox(height: 8),
            const Text('AIが作成した文章です。送る前に内容を確認してください。',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          ]),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
            child: Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onRegenerate,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.silver,
                    side: const BorderSide(color: AppColors.silverDim),
                    minimumSize: const Size(0, 48),
                  ),
                  child: const Text('作り直す'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: ElevatedButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: text));
                    if (ctx.mounted) {
                      ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(
                          content: Text('コピーしました。LINEに貼り付けてください'),
                          behavior: SnackBarBehavior.floating));
                    }
                  },
                  icon: const Icon(Icons.copy_rounded, size: 18),
                  label: const Text('コピー', style: TextStyle(fontWeight: FontWeight.w800)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.yellow,
                    foregroundColor: AppColors.navyDark,
                    minimumSize: const Size(0, 48),
                  ),
                ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}
