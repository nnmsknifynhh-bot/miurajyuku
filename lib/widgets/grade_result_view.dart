// ============================================================
// 採点結果の表示部品（生徒・先生 共通）
//   判定は ○（正解）・×（不正解）・保留（講師が判断）の3つ
//   正答率は保留を除いて計算し、保留件数は別に表示する
// ============================================================
import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../services/grading_service.dart';
import '../theme/app_theme.dart';

const Color redPen = Color(0xFFE53935);
const Color holdColor = Color(0xFFFF9800);

Color judgmentColor(String j) => j == Judgment.ok
    ? AppColors.success
    : j == Judgment.ng
        ? AppColors.danger
        : holdColor;

/// 正答率（保留を除く）と保留件数
class ScoreHeader extends StatelessWidget {
  final GradeCounts counts;
  const ScoreHeader({super.key, required this.counts});

  @override
  Widget build(BuildContext context) {
    final rate = counts.rate;
    final color = counts.graded == 0
        ? AppColors.silverDim
        : rate >= 0.8
            ? AppColors.success
            : rate >= 0.5
                ? AppColors.warning
                : AppColors.danger;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(children: [
        Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          const Text('正答率（保留を除く）', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
            Text('${counts.ok}', style: TextStyle(color: color, fontSize: 30, fontWeight: FontWeight.w900)),
            Text(' / ${counts.graded} 問',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 14, fontWeight: FontWeight.w600)),
            const SizedBox(width: 10),
            Text('${(rate * 100).round()}%',
                style: TextStyle(color: color, fontSize: 17, fontWeight: FontWeight.w800)),
          ]),
        ]),
        const Spacer(),
        if (counts.hold > 0)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: holdColor.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: holdColor),
            ),
            child: Text('保留 ${counts.hold}件',
                style: const TextStyle(color: holdColor, fontSize: 13, fontWeight: FontWeight.w800)),
          ),
      ]),
    );
  }
}

/// 判定バッジ（○ / × / 保留）。[onTap] を渡すと先生が切り替えられる
class JudgmentBadge extends StatelessWidget {
  final String judgment;
  final VoidCallback? onTap;
  const JudgmentBadge({super.key, required this.judgment, this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = judgmentColor(judgment);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: c.withValues(alpha: 0.15),
          border: Border.all(color: c, width: 2),
        ),
        alignment: Alignment.center,
        child: judgment == Judgment.hold
            ? const Text('保留', style: TextStyle(color: holdColor, fontSize: 12, fontWeight: FontWeight.w900))
            : Icon(judgment == Judgment.ok ? Icons.circle_outlined : Icons.close_rounded, color: c, size: 24),
      ),
    );
  }
}

/// ×・保留の1問分（ページ・問題／判定／生徒の解答／模範解答／原因・確認事項）
class ResultRow extends StatelessWidget {
  final GradeItem item;
  final bool forTeacher;
  final VoidCallback? onToggle;
  const ResultRow({super.key, required this.item, this.forTeacher = false, this.onToggle});

  @override
  Widget build(BuildContext context) {
    final it = item;
    final c = judgmentColor(it.judgment);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: it.isHold ? holdColor.withValues(alpha: 0.6) : AppColors.cardBorder),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        JudgmentBadge(judgment: it.judgment, onTap: onToggle),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(
                child: Text(it.label,
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700)),
              ),
              if (it.unit.isNotEmpty) ...[
                const SizedBox(width: 6),
                Flexible(
                  child: Text(it.unit,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                ),
              ],
            ]),
            const SizedBox(height: 4),
            _line(forTeacher ? '生徒の解答' : 'あなたの答え', it.studentAnswer, AppColors.silver),
            _line('模範解答', it.modelAnswerFound && it.modelAnswer.isNotEmpty ? it.modelAnswer : '（確認できませんでした）',
                AppColors.success),
            if (it.isNg && it.cause.isNotEmpty) _line('原因', it.cause, c),
            if (it.isNg && it.mistake.isNotEmpty) _line('間違えた内容', it.mistake, AppColors.textPrimary),
            if (it.isNg && it.review.isNotEmpty) _line('復習', it.review, AppColors.info),
            if (forTeacher && it.teacherCheck.isNotEmpty)
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: holdColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text('確認事項：${it.teacherCheck}',
                    style: const TextStyle(color: holdColor, fontSize: 12, height: 1.4)),
              ),
            if (forTeacher && it.teacherEdited && it.aiJudgment.isNotEmpty && it.aiJudgment != it.judgment)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('講師が修正（AIの判定: ${it.aiJudgment}）',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
              ),
          ]),
        ),
      ]),
    );
  }

  Widget _line(String label, String value, Color color) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text.rich(TextSpan(children: [
          TextSpan(text: '$label：', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          TextSpan(text: value, style: TextStyle(color: color, fontSize: 13, height: 1.4)),
        ])),
      );
}

/// コメント枠
class CommentBox extends StatelessWidget {
  final String title;
  final String text;
  final IconData icon;
  final Color color;
  const CommentBox(
      {super.key, required this.title, required this.text, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 6),
          Text(title, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
        ]),
        const SizedBox(height: 6),
        Text(text, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, height: 1.5)),
      ]),
    );
  }
}

/// 提出フォームでの写真プレビュー（全画面・拡大）
void showPhotoViewer(BuildContext context, List<Uint8List> photos, int initial) {
  showDialog(
    context: context,
    barrierColor: Colors.black,
    builder: (ctx) => _FullscreenPager(
      count: photos.length,
      initial: initial,
      builder: (i) => Image.memory(photos[i]),
    ),
  );
}

/// 状態ラベルの色
Color statusColor(String status) {
  switch (status) {
    case HomeworkSubmission.statusReturned:
      return AppColors.success;
    case HomeworkSubmission.statusGraded:
      return AppColors.yellow;
    case HomeworkSubmission.statusError:
      return AppColors.danger;
    default:
      return AppColors.info;
  }
}

// ============================================================
// 答案写真に赤ペンで ○ / × を書き込んで表示する
//   保留は オレンジの「?」（講師の画面のみ。保留が残っていると返却できない）
//   位置は AI が返した box（答えの範囲, 0〜1000）を使う
// ============================================================

/// 1枚の答案写真 + 採点マーク
class MarkedPhoto extends StatefulWidget {
  final Uint8List bytes;

  /// この写真の番号（1始まり）。items のうち photo が一致するものを描く
  final int photoNumber;
  final List<GradeItem> items;

  /// 右上に書く点数（例: "8/10"）。null なら書かない
  final String? scoreLabel;

  /// マークをタップしたとき（先生が判定を切り替える）。null なら切り替え不可
  final void Function(GradeItem item)? onToggleItem;

  /// マーク以外をタップしたとき（拡大表示など）
  final VoidCallback? onTapPhoto;

  const MarkedPhoto({
    super.key,
    required this.bytes,
    required this.photoNumber,
    required this.items,
    this.scoreLabel,
    this.onToggleItem,
    this.onTapPhoto,
  });

  @override
  State<MarkedPhoto> createState() => _MarkedPhotoState();
}

class _MarkedPhotoState extends State<MarkedPhoto> {
  double? _aspect; // 幅 / 高さ

  @override
  void initState() {
    super.initState();
    _measure();
  }

  @override
  void didUpdateWidget(MarkedPhoto old) {
    super.didUpdateWidget(old);
    if (!identical(old.bytes, widget.bytes)) _measure();
  }

  Future<void> _measure() async {
    try {
      final img = await decodeImageFromList(widget.bytes);
      final a = img.width / img.height;
      img.dispose();
      if (mounted) setState(() => _aspect = a);
    } catch (_) {
      if (mounted) setState(() => _aspect = 3 / 4);
    }
  }

  List<GradeItem> get _mine =>
      widget.items.where((it) => it.photo == widget.photoNumber && it.box != null).toList();

  @override
  Widget build(BuildContext context) {
    if (_aspect == null) {
      return const AspectRatio(
        aspectRatio: 3 / 4,
        child: Center(child: CircularProgressIndicator(color: AppColors.yellow, strokeWidth: 2)),
      );
    }
    return AspectRatio(
      aspectRatio: _aspect!,
      child: LayoutBuilder(builder: (context, c) {
        final size = c.biggest;
        final marks = _mine;
        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapUp: (d) {
            if (widget.onToggleItem != null) {
              final hit = _hitTest(marks, size, d.localPosition);
              if (hit != null) return widget.onToggleItem!(hit);
            }
            widget.onTapPhoto?.call();
          },
          child: Stack(fit: StackFit.expand, children: [
            Image.memory(widget.bytes, fit: BoxFit.fill, gaplessPlayback: true),
            CustomPaint(painter: _RedPenPainter(marks, widget.scoreLabel)),
          ]),
        );
      }),
    );
  }

  GradeItem? _hitTest(List<GradeItem> marks, Size size, Offset p) {
    GradeItem? best;
    double bestD = double.infinity;
    for (final it in marks) {
      final m = _MarkGeometry.of(it, size);
      final d = (m.center - p).distance;
      final reach = m.oval.longestSide / 2 + 16;
      if (d < reach && d < bestD) {
        best = it;
        bestD = d;
      }
    }
    return best;
  }
}

/// マークの位置と大きさ（描画とタップ判定で共通）
class _MarkGeometry {
  final Offset center;
  final Rect oval;
  final double stroke;
  _MarkGeometry(this.center, this.oval, this.stroke);

  factory _MarkGeometry.of(GradeItem it, Size size) {
    final b = it.box!;
    final r = Rect.fromLTRB(
      b[1] / 1000 * size.width,
      b[0] / 1000 * size.height,
      b[3] / 1000 * size.width,
      b[2] / 1000 * size.height,
    );
    final short = size.shortestSide;
    final h = (r.height * 2.0).clamp(short * 0.07, short * 0.24);
    final w = (r.width * 1.15 + h * 0.3).clamp(h, size.width * 0.9);
    final oval = Rect.fromCenter(center: r.center, width: w, height: h);
    final stroke = (h * 0.08).clamp(1.5, 10.0);
    return _MarkGeometry(r.center, oval, stroke);
  }
}

class _RedPenPainter extends CustomPainter {
  final List<GradeItem> items;
  final String? scoreLabel;
  _RedPenPainter(this.items, this.scoreLabel);

  @override
  void paint(Canvas canvas, Size size) {
    for (final it in items) {
      final g = _MarkGeometry.of(it, size);
      final pen = Paint()
        ..color = (it.isHold ? holdColor : redPen).withValues(alpha: 0.9)
        ..style = PaintingStyle.stroke
        ..strokeWidth = it.isOk ? g.stroke : g.stroke * 1.3
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      final s = g.oval.height;
      final c = g.center;
      if (it.isOk) {
        canvas.drawOval(g.oval, pen);
      } else if (it.isNg) {
        // × を答えの上に書く
        final d = s * 0.42;
        canvas.drawLine(Offset(c.dx - d, c.dy - d), Offset(c.dx + d, c.dy + d), pen);
        canvas.drawLine(Offset(c.dx + d, c.dy - d), Offset(c.dx - d, c.dy + d), pen);
        // 先生が問題集に書くように、正しい答えを赤で書き添える
        if (it.modelAnswerFound && it.modelAnswer.isNotEmpty) {
          _writeAnswer(canvas, size, g, it.modelAnswer);
        }
      } else {
        // 保留：オレンジの破線の枠 + 「?」
        final dash = Path()..addOval(g.oval);
        for (final m in dash.computeMetrics()) {
          for (double t = 0; t < m.length; t += pen.strokeWidth * 4) {
            canvas.drawPath(m.extractPath(t, t + pen.strokeWidth * 2.2), pen);
          }
        }
        final tp = TextPainter(
          text: TextSpan(
              text: '?', style: TextStyle(color: holdColor, fontSize: s * 0.75, fontWeight: FontWeight.w900)),
          textDirection: TextDirection.ltr,
        )..layout();
        tp.paint(canvas, Offset(g.oval.right + s * 0.05, c.dy - tp.height / 2));
      }
    }

    if (scoreLabel != null) {
      final fontSize = size.width * 0.085;
      final tp = TextPainter(
        text: TextSpan(
          text: scoreLabel,
          style: TextStyle(color: redPen, fontSize: fontSize, fontWeight: FontWeight.w900, height: 1),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      final pad = fontSize * 0.35;
      final topRight = Offset(size.width - tp.width - pad * 2.2, pad * 1.2);
      final bg = Rect.fromLTWH(topRight.dx - pad, topRight.dy - pad * 0.6, tp.width + pad * 2, tp.height + pad * 1.4);
      canvas.drawRRect(RRect.fromRectAndRadius(bg, Radius.circular(pad)),
          Paint()..color = Colors.white.withValues(alpha: 0.85));
      tp.paint(canvas, topRight);
      final line = Paint()
        ..color = redPen
        ..strokeWidth = (fontSize * 0.06).clamp(1.0, 4.0);
      final y1 = topRight.dy + tp.height + pad * 0.2;
      canvas.drawLine(Offset(topRight.dx, y1), Offset(topRight.dx + tp.width, y1), line);
      canvas.drawLine(Offset(topRight.dx, y1 + line.strokeWidth * 2),
          Offset(topRight.dx + tp.width, y1 + line.strokeWidth * 2), line);
    }
  }

  /// × の右（入らなければ下）に模範解答を赤で書く
  void _writeAnswer(Canvas canvas, Size size, _MarkGeometry g, String answer) {
    final fontSize = (g.oval.height * 0.42).clamp(9.0, size.width * 0.05);
    final maxW = size.width * 0.45;
    final tp = TextPainter(
      text: TextSpan(
        text: answer,
        style: TextStyle(color: redPen, fontSize: fontSize, fontWeight: FontWeight.w800, height: 1.15),
      ),
      textDirection: TextDirection.ltr,
      maxLines: 2,
      ellipsis: '…',
    )..layout(maxWidth: maxW);
    var pos = Offset(g.oval.right + fontSize * 0.4, g.center.dy - tp.height / 2);
    if (pos.dx + tp.width > size.width - 4) {
      pos = Offset((g.center.dx - tp.width / 2).clamp(4.0, size.width - tp.width - 4), g.oval.bottom + 2);
    }
    final bg = Rect.fromLTWH(pos.dx - 3, pos.dy - 2, tp.width + 6, tp.height + 4);
    canvas.drawRRect(RRect.fromRectAndRadius(bg, const Radius.circular(4)),
        Paint()..color = Colors.white.withValues(alpha: 0.8));
    tp.paint(canvas, pos);
  }

  @override
  bool shouldRepaint(_RedPenPainter old) => true;
}

/// 採点マーク付きの答案写真を縦に並べる（1枚目の右上に正答数/採点数）
class MarkedPhotoList extends StatelessWidget {
  final List<Uint8List>? photos; // null = 読み込み中
  final String? error;
  final List<GradeItem> items;
  final void Function(GradeItem item)? onToggleItem;

  const MarkedPhotoList({
    super.key,
    required this.photos,
    required this.items,
    this.error,
    this.onToggleItem,
  });

  String get _score => GradeCounts.of(items).scoreText;

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return Text('写真を読み込めませんでした: $error',
          style: const TextStyle(color: AppColors.danger, fontSize: 12));
    }
    if (photos == null) {
      return const SizedBox(
        height: 240,
        child: Center(child: CircularProgressIndicator(color: AppColors.yellow, strokeWidth: 2)),
      );
    }
    return Column(children: [
      for (var i = 0; i < photos!.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: MarkedPhoto(
              bytes: photos![i],
              photoNumber: i + 1,
              items: items,
              scoreLabel: i == 0 && items.isNotEmpty ? _score : null,
              onToggleItem: onToggleItem,
              onTapPhoto: () => showDialog(
                context: context,
                barrierColor: Colors.black,
                builder: (_) => _FullscreenPager(
                  count: photos!.length,
                  initial: i,
                  builder: (k) => MarkedPhoto(
                    bytes: photos![k],
                    photoNumber: k + 1,
                    items: items,
                    scoreLabel: k == 0 && items.isNotEmpty ? _score : null,
                  ),
                ),
              ),
            ),
          ),
        ),
    ]);
  }
}

class _FullscreenPager extends StatelessWidget {
  final int count;
  final int initial;
  final Widget Function(int i) builder;
  const _FullscreenPager({required this.count, required this.initial, required this.builder});

  @override
  Widget build(BuildContext context) {
    return Stack(children: [
      PageView.builder(
        controller: PageController(initialPage: initial),
        itemCount: count,
        itemBuilder: (_, i) => InteractiveViewer(maxScale: 5, child: Center(child: builder(i))),
      ),
      Positioned(
        top: 16,
        right: 16,
        child: SafeArea(
          child: IconButton(
            style: IconButton.styleFrom(backgroundColor: Colors.black54),
            icon: const Icon(Icons.close, color: Colors.white),
            onPressed: () => Navigator.pop(context),
          ),
        ),
      ),
    ]);
  }
}
