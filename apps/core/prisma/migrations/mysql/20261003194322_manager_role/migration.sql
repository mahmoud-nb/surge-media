-- AlterTable
ALTER TABLE `User` ADD COLUMN `invitedById` VARCHAR(191) NULL,
    MODIFY `role` ENUM('ADMIN', 'MANAGER', 'DEVELOPER', 'EDITOR') NOT NULL DEFAULT 'EDITOR';

-- CreateIndex
CREATE INDEX `User_invitedById_idx` ON `User`(`invitedById`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise de données (rôle Gestionnaire) :
-- 1. les développeurs propriétaires d'au moins un projet deviennent gestionnaires (aucune perte de droits) ;
UPDATE `User` SET `role` = 'MANAGER'
WHERE `role` = 'DEVELOPER'
  AND EXISTS (SELECT 1 FROM `ProjectMember` m WHERE m.`userId` = `User`.`id` AND m.`role` = 'OWNER');
-- 2. un gestionnaire est propriétaire de tout projet dont il est membre ;
UPDATE `ProjectMember` SET `role` = 'OWNER'
WHERE `role` <> 'OWNER' AND `userId` IN (SELECT `id` FROM `User` WHERE `role` = 'MANAGER');
-- 3. les autres adhésions sont ramenées au plafond du rôle de plateforme (rôle enregistré = rôle exercé).
UPDATE `ProjectMember` SET `role` = 'DEVELOPER'
WHERE `role` = 'OWNER' AND `userId` IN (SELECT `id` FROM `User` WHERE `role` = 'DEVELOPER');
UPDATE `ProjectMember` SET `role` = 'EDITOR'
WHERE `role` <> 'EDITOR' AND `userId` IN (SELECT `id` FROM `User` WHERE `role` = 'EDITOR');
