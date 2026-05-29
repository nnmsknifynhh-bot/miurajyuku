import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../theme/app_theme.dart';
import '../../models/app_models.dart';
import '../../providers/app_provider.dart';
import '../student/student_home.dart';
import '../admin/admin_home.dart';
import '../parent/parent_home.dart';
import '../teacher/teacher_home.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> with TickerProviderStateMixin {
  UserRole _selectedRole = UserRole.student;
  final _idController = TextEditingController();
  final _pwController = TextEditingController();
  bool _obscure = true;
  bool _loading = false;
  late AnimationController _animController;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));
    _fadeAnim = CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();
  }

  @override
  void dispose() {
    _animController.dispose();
    _idController.dispose();
    _pwController.dispose();
    super.dispose();
  }

  void _login() async {
    final provider = context.read<AppProvider>();
    setState(() => _loading = true);
    await Future.delayed(const Duration(milliseconds: 600));

    final success = provider.login(_idController.text.trim(), _pwController.text.trim(), _selectedRole);
    if (!mounted) return;

    setState(() => _loading = false);
    if (success) {
      Widget dest;
      switch (_selectedRole) {
        case UserRole.student:
          dest = const StudentHome();
          break;
        case UserRole.admin:
          dest = const AdminHome();
          break;
        case UserRole.parent:
          dest = const ParentHome();
          break;
        case UserRole.teacher:
          dest = const TeacherHome();
          break;
      }
      Navigator.of(context).pushReplacement(
        PageRouteBuilder(
          pageBuilder: (_, __, ___) => dest,
          transitionsBuilder: (_, anim, __, child) =>
              FadeTransition(opacity: anim, child: child),
          transitionDuration: const Duration(milliseconds: 500),
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('IDまたはパスワードが違います'),
          backgroundColor: AppColors.danger,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppGradients.navyGradient),
        child: SafeArea(
          child: FadeTransition(
            opacity: _fadeAnim,
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 28),
              child: Column(
                children: [
                  const SizedBox(height: 50),
                  _buildLogo(),
                  const SizedBox(height: 36),
                  _buildRoleSelector(),
                  const SizedBox(height: 28),
                  _buildForm(),
                  const SizedBox(height: 28),
                  _buildLoginButton(),
                  const SizedBox(height: 20),
                  _buildForgotPasswordLink(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLogo() {
    return Column(
      children: [
        Container(
          width: 90,
          height: 90,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(
              colors: [AppColors.navyCard, AppColors.navyLight],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            border: Border.all(color: AppColors.yellow, width: 2.5),
            boxShadow: [
              BoxShadow(color: AppColors.yellow.withValues(alpha: 0.3), blurRadius: 20, spreadRadius: 3),
            ],
          ),
          child: const Center(
            child: Text('M', style: TextStyle(
              color: AppColors.yellow,
              fontSize: 44,
              fontWeight: FontWeight.w900,
              letterSpacing: -2,
            )),
          ),
        ),
        const SizedBox(height: 16),
        const Text('三浦塾', style: TextStyle(
          color: AppColors.textPrimary,
          fontSize: 28,
          fontWeight: FontWeight.w800,
          letterSpacing: 4,
        )),
        const SizedBox(height: 4),
        const Text('STUDY MASTER', style: TextStyle(
          color: AppColors.yellow,
          fontSize: 13,
          fontWeight: FontWeight.w600,
          letterSpacing: 6,
        )),
      ],
    );
  }

  Widget _buildRoleSelector() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.navyCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(
        children: [
          // 上段: 生徒 / 保護者
          Row(
            children: [
              _roleTab(UserRole.student, '生徒', Icons.school),
              _roleTab(UserRole.parent, '保護者', Icons.family_restroom),
            ],
          ),
          const SizedBox(height: 4),
          // 下段: 管理者 / 講師
          Row(
            children: [
              _roleTab(UserRole.admin, '管理者', Icons.admin_panel_settings),
              _roleTab(UserRole.teacher, '講師', Icons.person_pin),
            ],
          ),
        ],
      ),
    );
  }

  Widget _roleTab(UserRole role, String label, IconData icon) {
    final selected = _selectedRole == role;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() {
          _selectedRole = role;
          _idController.clear();
          _pwController.clear();
        }),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: selected ? AppColors.yellow : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: selected ? AppColors.navyDark : AppColors.silverDim, size: 18),
              const SizedBox(height: 4),
              Text(label, style: TextStyle(
                color: selected ? AppColors.navyDark : AppColors.silverDim,
                fontSize: 12,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
              )),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildForm() {
    String idHint, idLabel;
    switch (_selectedRole) {
      case UserRole.student:
        idHint = '例：s1'; idLabel = '生徒ID';
        break;
      case UserRole.parent:
        idHint = '例：parent1'; idLabel = '保護者ID';
        break;
      case UserRole.admin:
        idHint = 'admin'; idLabel = '管理者ID';
        break;
      case UserRole.teacher:
        idHint = '例：t1'; idLabel = '講師ID';
        break;
    }

    return Column(
      children: [
        TextField(
          controller: _idController,
          decoration: InputDecoration(
            labelText: idLabel,
            hintText: idHint,
            prefixIcon: const Icon(Icons.person_outline, color: AppColors.silverDim),
          ),
          style: const TextStyle(color: AppColors.textPrimary),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _pwController,
          obscureText: _obscure,
          decoration: InputDecoration(
            labelText: 'パスワード',
            hintText: '例：1234',
            prefixIcon: const Icon(Icons.lock_outline, color: AppColors.silverDim),
            suffixIcon: IconButton(
              onPressed: () => setState(() => _obscure = !_obscure),
              icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility, color: AppColors.silverDim),
            ),
          ),
          style: const TextStyle(color: AppColors.textPrimary),
          onSubmitted: (_) => _login(),
        ),
      ],
    );
  }

  Widget _buildLoginButton() {
    return SizedBox(
      height: 58,
      child: ElevatedButton(
        onPressed: _loading ? null : _login,
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.yellow,
          foregroundColor: AppColors.navyDark,
          minimumSize: const Size(double.infinity, 58),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          elevation: 0,
        ).copyWith(
          overlayColor: WidgetStateProperty.all(AppColors.navyDark.withValues(alpha: 0.1)),
        ),
        child: _loading
            ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: AppColors.navyDark, strokeWidth: 3))
            : const Text('ログイン', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 2)),
      ),
    );
  }

  Widget _buildForgotPasswordLink() {
    // 生徒・保護者ロール時のみ表示
    if (_selectedRole != UserRole.student && _selectedRole != UserRole.parent) {
      return const SizedBox.shrink();
    }
    return TextButton(
      onPressed: () => _showPasswordResetDialog(),
      child: const Text(
        'パスワードを忘れた方はこちら',
        style: TextStyle(
          color: AppColors.silverDim,
          fontSize: 13,
          decoration: TextDecoration.underline,
          decorationColor: AppColors.silverDim,
        ),
      ),
    );
  }

  void _showPasswordResetDialog() {
    final idCtrl = TextEditingController(text: _idController.text.trim());
    final newPwCtrl = TextEditingController();
    final confirmPwCtrl = TextEditingController();
    bool obscureNew = true;
    bool obscureConfirm = true;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: AppColors.navyCard,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('パスワード再設定',
              style: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _selectedRole == UserRole.student ? '生徒IDと新しいパスワードを入力してください' : '保護者IDと新しいパスワードを入力してください',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: idCtrl,
                  decoration: InputDecoration(
                    labelText: _selectedRole == UserRole.student ? '生徒ID' : '保護者ID',
                    prefixIcon: const Icon(Icons.person_outline, color: AppColors.silverDim),
                  ),
                  style: const TextStyle(color: AppColors.textPrimary),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: newPwCtrl,
                  obscureText: obscureNew,
                  decoration: InputDecoration(
                    labelText: '新しいパスワード',
                    prefixIcon: const Icon(Icons.lock_outline, color: AppColors.silverDim),
                    suffixIcon: IconButton(
                      icon: Icon(obscureNew ? Icons.visibility_off : Icons.visibility, color: AppColors.silverDim),
                      onPressed: () => setDialogState(() => obscureNew = !obscureNew),
                    ),
                  ),
                  style: const TextStyle(color: AppColors.textPrimary),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: confirmPwCtrl,
                  obscureText: obscureConfirm,
                  decoration: InputDecoration(
                    labelText: '確認用パスワード',
                    prefixIcon: const Icon(Icons.lock_outline, color: AppColors.silverDim),
                    suffixIcon: IconButton(
                      icon: Icon(obscureConfirm ? Icons.visibility_off : Icons.visibility, color: AppColors.silverDim),
                      onPressed: () => setDialogState(() => obscureConfirm = !obscureConfirm),
                    ),
                  ),
                  style: const TextStyle(color: AppColors.textPrimary),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.yellow,
                foregroundColor: AppColors.navyDark,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: () {
                final id = idCtrl.text.trim();
                final newPw = newPwCtrl.text.trim();
                final confirmPw = confirmPwCtrl.text.trim();
                if (id.isEmpty || newPw.isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: const Text('IDとパスワードを入力してください'), backgroundColor: AppColors.danger,
                        behavior: SnackBarBehavior.floating,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                  );
                  return;
                }
                if (newPw != confirmPw) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: const Text('パスワードが一致しません'), backgroundColor: AppColors.danger,
                        behavior: SnackBarBehavior.floating,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                  );
                  return;
                }
                if (newPw.length < 4) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: const Text('パスワードは4文字以上で設定してください'), backgroundColor: AppColors.danger,
                        behavior: SnackBarBehavior.floating,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                  );
                  return;
                }
                final provider = context.read<AppProvider>();
                final success = provider.changePassword(
                  userId: id,
                  role: _selectedRole,
                  newPassword: newPw,
                );
                Navigator.pop(ctx);
                if (success) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: const Text('パスワードを変更しました'), backgroundColor: AppColors.success,
                        behavior: SnackBarBehavior.floating,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                  );
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: const Text('IDが見つかりません'), backgroundColor: AppColors.danger,
                        behavior: SnackBarBehavior.floating,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                  );
                }
              },
              child: const Text('変更する', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ),
    );
  }
}
