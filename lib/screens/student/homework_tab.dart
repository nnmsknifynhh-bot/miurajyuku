// ============================================================
// 生徒：宿題提出タブ
// 問題集を選ぶ → ページを入力 → 写真を撮る → 提出
// 先生が返却すると、ここで ○× と点数が見られる
// ============================================================
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../providers/app_provider.dart';
import '../../services/grading_service.dart';
import '../../services/photo_picker.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/grade_result_view.dart';

class HomeworkTab extends StatefulWidget {
  /// 未読の返却数が変わったときに親（ナビのバッジ）へ知らせる
  final ValueChanged<int>? onUnreadChanged;
  const HomeworkTab({super.key, this.onUnreadChanged});

  @override
  State<HomeworkTab> createState() => _HomeworkTabState();
}

class _HomeworkTabState extends State<HomeworkTab> {
  final _svc = GradingService.instance;
  final _pagesCtrl = TextEditingController();

  List<String> _workbooks = [];
  String? _workbook;
  String? _subject;
  static const _subjects = ['数学', '英語', '国語', '理科', '社会'];
  static const _maxPhotos = 4; // ルール：4ページ（見開き2組）ずつ採点
  final List<Uint8List> _photos = [];
  bool _submitting = false;

  List<HomeworkSubmission>? _mine;
  Set<String> _seen = {};
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _pagesCtrl.dispose();
    super.dispose();
  }

  String get _studentId => context.read<AppProvider>().currentUser?.id ?? '';

  Future<void> _reload() async {
    setState(() => _loadError = null);
    try {
      final results = await Future.wait([
        _svc.listWorkbooks(),
        _svc.listMine(_studentId),
        _svc.seenReturnedIds(),
      ]);
      if (!mounted) return;
      setState(() {
        _workbooks = results[0] as List<String>;
        if (_workbook != null && !_workbooks.contains(_workbook)) _workbook = null;
        _mine = results[1] as List<HomeworkSubmission>;
        _seen = results[2] as Set<String>;
      });
      _notifyUnread();
    } catch (e) {
      if (mounted) setState(() { _loadError = '$e'; _mine ??= []; });
    }
  }

  void _notifyUnread() {
    final n = (_mine ?? []).where((s) => s.isReturned && !_seen.contains(s.id)).length;
    widget.onUnreadChanged?.call(n);
  }

  Future<void> _addPhotos({required bool camera}) async {
    try {
      final picked = await PhotoPicker.pick(camera: camera);
      if (picked.isEmpty || !mounted) return;
      setState(() {
        _photos.addAll(picked);
        if (_photos.length > _maxPhotos) {
          _photos.removeRange(_maxPhotos, _photos.length);
          _snack('1回に送れるのは$_maxPhotosページまでです。続きは次の提出で送ってください', AppColors.warning);
        }
      });
    } catch (e) {
      _snack('写真を読み込めませんでした: $e', AppColors.danger);
    }
  }

  Future<void> _submit() async {
    if (_subject == null) return _snack('教科を選んでください', AppColors.danger);
    if (_workbook == null) return _snack('問題集を選んでください', AppColors.danger);
    if (_pagesCtrl.text.trim().isEmpty) return _snack('ページを入力してください', AppColors.danger);
    if (_photos.isEmpty) return _snack('答案の写真を撮ってください', AppColors.danger);

    final user = context.read<AppProvider>().currentUser;
    setState(() => _submitting = true);
    try {
      await _svc.submit(
        studentId: user?.id ?? '',
        studentName: user?.name ?? '',
        grade: user?.grade == null ? '' : '中${user!.grade}',
        subject: _subject!,
        workbook: _workbook!,
        pages: _pagesCtrl.text.trim(),
        jpegImages: List.of(_photos),
      );
      if (!mounted) return;
      setState(() {
        _photos.clear();
        _pagesCtrl.clear();
      });
      _snack('提出しました！先生のチェック後に返却されます', AppColors.success);
      await _reload();
    } catch (e) {
      _snack('$e', AppColors.danger);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
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

  Future<void> _openResult(HomeworkSubmission s) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => _ReturnedDetailPage(submission: s, studentId: _studentId),
    ));
    await _svc.markReturnedSeen(s.id);
    if (!mounted) return;
    setState(() => _seen.add(s.id));
    _notifyUnread();
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: AppColors.yellow,
      onRefresh: _reload,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          _header('宿題を提出', Icons.camera_alt_rounded),
          const SizedBox(height: 12),
          _buildForm(),
          const SizedBox(height: 28),
          Row(children: [
            Expanded(child: _header('提出した宿題', Icons.history_rounded)),
            IconButton(
              tooltip: '更新',
              onPressed: _reload,
              icon: const Icon(Icons.refresh, color: AppColors.silverDim),
            ),
          ]),
          const SizedBox(height: 8),
          if (_loadError != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_loadError!, style: const TextStyle(color: AppColors.danger, fontSize: 12)),
            ),
          if (_mine == null)
            const Padding(padding: EdgeInsets.all(24), child: AppLoader())
          else if (_mine!.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Text('まだ提出はありません', style: TextStyle(color: AppColors.textSecondary)),
              ),
            )
          else
            ..._mine!.map((s) => _SubmissionCard(
                  submission: s,
                  isNew: s.isReturned && !_seen.contains(s.id),
                  onTap: s.isReturned ? () => _openResult(s) : null,
                )),
        ],
      ),
    );
  }

  Widget _buildForm() {
    return GlowCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('教科', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        const SizedBox(height: 6),
        Wrap(spacing: 8, runSpacing: 6, children: [
          for (final sub in _subjects)
            ChoiceChip(
              label: Text(sub),
              selected: _subject == sub,
              onSelected: _submitting ? null : (_) => setState(() => _subject = sub),
              selectedColor: AppColors.yellow.withValues(alpha: 0.2),
              backgroundColor: AppColors.card,
              side: BorderSide(color: _subject == sub ? AppColors.yellow : AppColors.cardBorder),
              labelStyle: TextStyle(
                  color: _subject == sub ? AppColors.yellow : AppColors.textSecondary,
                  fontWeight: _subject == sub ? FontWeight.w700 : FontWeight.w400),
              showCheckmark: false,
            ),
        ]),
        const SizedBox(height: 14),
        DropdownButtonFormField<String>(
          initialValue: _workbook,
          isExpanded: true,
          dropdownColor: AppColors.navyCard,
          decoration: const InputDecoration(
            labelText: '問題集',
            prefixIcon: Icon(Icons.menu_book_rounded, color: AppColors.silverDim),
          ),
          hint: Text(_workbooks.isEmpty ? '問題集がまだ登録されていません' : '選んでください',
              style: const TextStyle(color: AppColors.silverDim, fontSize: 14)),
          items: _workbooks
              .map((w) => DropdownMenuItem(
                  value: w, child: Text(w, style: const TextStyle(color: AppColors.textPrimary))))
              .toList(),
          onChanged: _submitting
              ? null
              : (v) => setState(() {
                    _workbook = v;
                    // 問題集名に教科が入っていれば自動で選ぶ
                    final hit = _subjects.where((sub) => (v ?? '').contains(sub));
                    if (hit.isNotEmpty) _subject = hit.first;
                  }),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _pagesCtrl,
          enabled: !_submitting,
          style: const TextStyle(color: AppColors.textPrimary),
          decoration: const InputDecoration(
            labelText: 'ページ（例: 12-13）',
            prefixIcon: Icon(Icons.bookmark_outline, color: AppColors.silverDim),
          ),
        ),
        const SizedBox(height: 14),
        if (_photos.isNotEmpty) ...[
          SizedBox(
            height: 96,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _photos.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (ctx, i) => Stack(children: [
                GestureDetector(
                  onTap: () => showPhotoViewer(ctx, _photos, i),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.memory(_photos[i], height: 96, width: 72, fit: BoxFit.cover),
                  ),
                ),
                if (!_submitting)
                  Positioned(
                    top: 2,
                    right: 2,
                    child: GestureDetector(
                      onTap: () => setState(() => _photos.removeAt(i)),
                      child: const CircleAvatar(
                        radius: 11,
                        backgroundColor: Colors.black87,
                        child: Icon(Icons.close, size: 14, color: Colors.white),
                      ),
                    ),
                  ),
              ]),
            ),
          ),
          const SizedBox(height: 10),
        ],
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _submitting ? null : () => _addPhotos(camera: true),
              icon: const Icon(Icons.photo_camera_outlined, size: 18),
              label: const Text('撮影する'),
              style: _outlined(),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _submitting ? null : () => _addPhotos(camera: false),
              icon: const Icon(Icons.photo_library_outlined, size: 18),
              label: const Text('写真を選ぶ'),
              style: _outlined(),
            ),
          ),
        ]),
        const SizedBox(height: 4),
        Text('写真 ${_photos.length}/$_maxPhotos枚・1ページずつ、真上からはっきり撮ってください',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
        const SizedBox(height: 14),
        ElevatedButton(
          onPressed: _submitting ? null : _submit,
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.yellow,
            foregroundColor: AppColors.navyDark,
            disabledBackgroundColor: AppColors.yellow.withValues(alpha: 0.3),
            minimumSize: const Size(double.infinity, 50),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
          child: _submitting
              ? const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.navyDark)),
                  SizedBox(width: 10),
                  Text('送信・採点中…（1分ほどかかります）', style: TextStyle(fontWeight: FontWeight.w700)),
                ])
              : const Text('提出する', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
        ),
      ]),
    );
  }

  Widget _header(String title, IconData icon) => Row(children: [
        Icon(icon, color: AppColors.yellow, size: 20),
        const SizedBox(width: 8),
        Text(title,
            style: const TextStyle(color: AppColors.textPrimary, fontSize: 17, fontWeight: FontWeight.w700)),
      ]);

  ButtonStyle _outlined() => OutlinedButton.styleFrom(
        foregroundColor: AppColors.info,
        side: const BorderSide(color: AppColors.info),
        minimumSize: const Size(0, 44),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      );
}

class _SubmissionCard extends StatelessWidget {
  final HomeworkSubmission submission;
  final bool isNew;
  final VoidCallback? onTap;
  const _SubmissionCard({required this.submission, required this.isNew, this.onTap});

  @override
  Widget build(BuildContext context) {
    final s = submission;
    final date = s.submittedAt == null ? '' : DateFormat('M/d HH:mm', 'ja').format(s.submittedAt!);
    final color = statusColor(s.status);
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: onTap,
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(
                child: Text(s.workbook,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700)),
              ),
              if (isNew) ...[
                const SizedBox(width: 6),
                const AppChip(label: 'NEW', color: AppColors.danger),
              ],
            ]),
            const SizedBox(height: 4),
            Text('p.${s.pages}・$date 提出',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          ]),
        ),
        if (s.isReturned && s.items.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Text(GradeCounts.of(s.items).scoreText,
                style: const TextStyle(color: AppColors.yellow, fontSize: 18, fontWeight: FontWeight.w800)),
          ),
        AppChip(label: s.status, color: color),
        if (onTap != null) const Icon(Icons.chevron_right, color: AppColors.silverDim),
      ]),
    );
  }
}

/// 返却された宿題の詳細
class _ReturnedDetailPage extends StatefulWidget {
  final HomeworkSubmission submission;
  final String studentId;
  const _ReturnedDetailPage({required this.submission, required this.studentId});

  @override
  State<_ReturnedDetailPage> createState() => _ReturnedDetailPageState();
}

class _ReturnedDetailPageState extends State<_ReturnedDetailPage> {
  List<Uint8List>? _photos;
  String? _photoError;

  @override
  void initState() {
    super.initState();
    GradingService.instance
        .getImages(widget.submission.id, studentId: widget.studentId)
        .then((p) => mounted ? setState(() => _photos = p) : null)
        .catchError((e) => mounted ? setState(() => _photoError = '$e') : null);
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.submission;
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: Text('${s.workbook}  p.${s.pages}')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          ScoreHeader(counts: GradeCounts.of(s.items)),
          const SizedBox(height: 12),
          if (s.teacherComment.isNotEmpty) ...[
            CommentBox(
                title: '先生から', text: s.teacherComment, icon: Icons.school, color: AppColors.yellow),
            const SizedBox(height: 8),
          ],
          const SizedBox(height: 4),
          MarkedPhotoList(photos: _photos, error: _photoError, items: s.items),
          if (s.overallComment.isNotEmpty) ...[
            CommentBox(
                title: 'ひとこと', text: s.overallComment, icon: Icons.lightbulb_outline, color: AppColors.info),
            const SizedBox(height: 16),
          ],
          if (s.items.any((it) => it.isNg)) ...[
            const Text('間違えた問題（解き直そう）',
                style: TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ...s.items.where((it) => it.isNg).map((it) => ResultRow(item: it)),
          ] else
            const Text('全問正解です！🎉', style: TextStyle(color: AppColors.success, fontSize: 15)),
        ],
      ),
    );
  }
}
