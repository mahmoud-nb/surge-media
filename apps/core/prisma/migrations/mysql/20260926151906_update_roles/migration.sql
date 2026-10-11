-- Le rôle VIEWER est supprimé : les comptes existants passent EDITOR (moindre privilège).
UPDATE `User` SET `role` = 'EDITOR' WHERE `role` = 'VIEWER';

-- AlterTable
ALTER TABLE `User` MODIFY `role` ENUM('ADMIN', 'EDITOR', 'DEVELOPER') NOT NULL DEFAULT 'EDITOR';
